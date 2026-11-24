import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

function getAppBaseUrl(req: express.Request): string {
  const envUrl = process.env.APP_URL;
  if (envUrl && !envUrl.includes('MY_APP_URL')) {
    return envUrl.replace(/\/$/, '');
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function zipCrc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ ZIP_CRC_TABLE[(c ^ buf[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

function buildZipArchive(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = zipCrc32(entry.data);
    const size = entry.data.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localRecord = Buffer.concat([localHeader, nameBuf, entry.data]);
    localParts.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(Buffer.concat([centralHeader, nameBuf]));
    offset += localRecord.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Add it in Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '35mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });



  function buildDesktopRuntimeAssets(defaultUpdateOrigin: string) {
    const buildTime = new Date().toISOString();
    const version = '1.1.0';

    const localServerCjs = `const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');

const CHMR_VERSION = '${version}';
const CHMR_BUILD_TIME = '${buildTime}';
const DEFAULT_UPDATE_ORIGIN = ${JSON.stringify(defaultUpdateOrigin)};

let activeDataDir = process.env.CHMR_DATA_DIR || __dirname;

function getConfigFilePath() {
  return path.join(activeDataDir, 'chmr-local-config.json');
}

function readLocalConfig() {
  try {
    const cfgPath = getConfigFilePath();
    if (!fs.existsSync(cfgPath)) return {};
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function writeLocalConfig(patch) {
  try {
    if (!fs.existsSync(activeDataDir)) {
      fs.mkdirSync(activeDataDir, { recursive: true });
    }
    const current = readLocalConfig();
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    fs.writeFileSync(getConfigFilePath(), JSON.stringify(next, null, 2), 'utf8');
    applySavedEnvOverrides();
    return next;
  } catch (err) {
    throw new Error('Failed to write local config: ' + (err && err.message ? err.message : String(err)));
  }
}

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\\r?\\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && !process.env[key]) {
      process.env[key] = val;
    }
  }
}

function applySavedEnvOverrides() {
  const cfg = readLocalConfig();
  if (cfg.googleClientId) process.env.GOOGLE_CLIENT_ID = cfg.googleClientId;
  if (cfg.googleClientSecret) process.env.GOOGLE_CLIENT_SECRET = cfg.googleClientSecret;
  if (cfg.geminiApiKey) process.env.GEMINI_API_KEY = cfg.geminiApiKey;
}

loadDotEnv(path.join(__dirname, '.env'));
applySavedEnvOverrides();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
};

const youtubePendingStates = new Map();
let activeYouTubeSession = null;

function readBody(req, maxBytes = 300 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    ...extraHeaders,
  });
  res.end(body);
}



async function resolveValidYouTubeSession() {
  const session = activeYouTubeSession;
  if (!session) return null;
  if (session.accessToken && session.expiresAt > Date.now() + 60000) {
    return session;
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !session.refreshToken) return null;

  try {
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: session.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const refreshed = await refreshRes.json();
    if (!refreshRes.ok || !refreshed.access_token) return null;
    const updated = {
      ...session,
      accessToken: refreshed.access_token,
      expiresAt: Date.now() + (refreshed.expires_in || 3600) * 1000,
    };
    activeYouTubeSession = updated;
    return updated;
  } catch {
    return null;
  }
}



function extractZipBufferToDir(zipBuffer, targetDir) {
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= Math.max(0, zipBuffer.length - 65558); i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Downloaded file is not a valid ZIP update package.');
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  let pos = zipBuffer.readUInt32LE(eocdOffset + 16);
  const updatedFiles = [];

  for (let idx = 0; idx < totalEntries; idx++) {
    if (zipBuffer.readUInt32LE(pos) !== 0x02014b50) break;
    const method = zipBuffer.readUInt16LE(pos + 10);
    const compSize = zipBuffer.readUInt32LE(pos + 20);
    const nameLen = zipBuffer.readUInt16LE(pos + 28);
    const extraLen = zipBuffer.readUInt16LE(pos + 30);
    const commentLen = zipBuffer.readUInt16LE(pos + 32);
    const localOffset = zipBuffer.readUInt32LE(pos + 42);
    const rawName = zipBuffer.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos += 46 + nameLen + extraLen + commentLen;

    const cleanRel = rawName.replace(/^CHMR-Windows\\//, '').replace(/^CHMR-Source-Desktop\\//, '');
    if (!cleanRel || cleanRel.endsWith('/')) continue;
    if (cleanRel === '.env' || cleanRel === 'chmr-local-config.json') continue;

    if (zipBuffer.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const lNameLen = zipBuffer.readUInt16LE(localOffset + 26);
    const lExtraLen = zipBuffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const compBuf = zipBuffer.subarray(dataStart, dataStart + compSize);
    const content = method === 0 ? compBuf : method === 8 ? zlib.inflateRawSync(compBuf) : null;
    if (!content) continue;

    const destPath = path.resolve(targetDir, cleanRel);
    if (!destPath.startsWith(path.resolve(targetDir))) continue;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content);
    updatedFiles.push(cleanRel);
  }
  return updatedFiles;
}

function startLocalServer(port = Number(process.env.PORT || 3000), dataDirOverride) {
  if (dataDirOverride) {
    activeDataDir = dataDirOverride;
    applySavedEnvOverrides();
  }
  const webRoot = fs.existsSync(path.join(__dirname, 'web', 'index.html'))
    ? path.join(__dirname, 'web')
    : path.join(__dirname, 'dist');

  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url || '/', \`http://localhost:\${port}\`);
      const pathname = urlObj.pathname;
      const localOrigin = \`http://localhost:\${port}\`;

      if (req.method === 'GET' && pathname === '/api/health') {
        return sendJson(res, 200, { ok: true, mode: 'local-desktop', version: CHMR_VERSION });
      }

      if (req.method === 'GET' && pathname === '/api/local/config') {
        const cfg = readLocalConfig();
        return sendJson(res, 200, {
          isLocalServer: true,
          version: CHMR_VERSION,
          buildTime: CHMR_BUILD_TIME,
          appDir: __dirname,
          dataDir: activeDataDir,
          hasLocalSource: fs.existsSync(path.join(__dirname, 'src', 'App.tsx')),
          updateOrigin: cfg.updateOrigin || DEFAULT_UPDATE_ORIGIN || '',
          googleClientId: process.env.GOOGLE_CLIENT_ID || '',
          googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
          geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
          youtubeCallbackUrl: \`\${localOrigin}/auth/youtube/callback\`,
        });
      }

      if (req.method === 'POST' && pathname === '/api/local/config') {
        const raw = await readBody(req, 1024 * 1024);
        const body = JSON.parse(raw.toString('utf8') || '{}');
        const patch = {};
        if (typeof body.googleClientId === 'string') patch.googleClientId = body.googleClientId.trim();
        if (typeof body.googleClientSecret === 'string' && body.googleClientSecret.trim()) {
          patch.googleClientSecret = body.googleClientSecret.trim();
        }
        if (typeof body.geminiApiKey === 'string' && body.geminiApiKey.trim()) {
          patch.geminiApiKey = body.geminiApiKey.trim();
        }
        if (typeof body.updateOrigin === 'string') patch.updateOrigin = body.updateOrigin.trim().replace(/\\/$/, '');
        writeLocalConfig(patch);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && pathname === '/api/desktop/update') {
        const raw = await readBody(req, 1024 * 1024);
        const body = JSON.parse(raw.toString('utf8') || '{}');
        const cfg = readLocalConfig();
        const origin = String(body.sourceUrl || cfg.updateOrigin || DEFAULT_UPDATE_ORIGIN || '').trim().replace(/\\/$/, '');
        if (!origin) {
          return sendJson(res, 400, { error: 'Enter your CHMR Update Source URL (or ZIP download URL) first.' });
        }
        const zipUrl = origin.endsWith('.zip') ? origin : \`\${origin}/api/desktop/windows-bundle.zip\`;
        const dlRes = await fetch(zipUrl);
        if (!dlRes.ok) {
          return sendJson(res, 502, { error: \`Update server returned HTTP \${dlRes.status} for \${zipUrl}\` });
        }
        const arrayBuf = await dlRes.arrayBuffer();
        const updatedFiles = extractZipBufferToDir(Buffer.from(arrayBuf), __dirname);
        writeLocalConfig({ updateOrigin: origin });
        return sendJson(res, 200, {
          ok: true,
          updatedCount: updatedFiles.length,
          requiresRestart: true,
        });
      }

      // Local YouTube Loopback OAuth (zero firebaseapp.com / zero cloud hosting)
      if (req.method === 'GET' && pathname === '/api/auth/youtube/status') {
        const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
        const session = configured ? await resolveValidYouTubeSession() : null;
        return sendJson(res, 200, {
          isLocalServer: true,
          configured,
          connected: Boolean(session),
          callbackUrl: \`\${localOrigin}/auth/youtube/callback\`,
          user: session
            ? { name: session.name || 'YouTube Creator', email: session.email || '', avatarUrl: session.avatarUrl }
            : null,
        });
      }

      if (req.method === 'GET' && pathname === '/api/auth/youtube/token') {
        const session = await resolveValidYouTubeSession();
        if (!session || !session.accessToken) {
          return sendJson(res, 401, { error: 'Not signed in locally to YouTube.' });
        }
        return sendJson(res, 200, {
          accessToken: session.accessToken,
          user: { name: session.name || 'YouTube Creator', email: session.email || '', avatarUrl: session.avatarUrl },
        });
      }

      if (req.method === 'GET' && pathname === '/api/auth/youtube/url') {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        const redirectUri = \`\${localOrigin}/auth/youtube/callback\`;
        if (!clientId || !clientSecret) {
          return sendJson(res, 400, {
            error: 'Add your Google OAuth Client ID and Secret in Desktop & Updates -> Local Accounts Setup first.',
            callbackUrl: redirectUri,
          });
        }
        const state = crypto.randomBytes(16).toString('hex');
        youtubePendingStates.set(state, { redirectUri, expiresAt: Date.now() + 10 * 60 * 1000 });
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly openid email profile',
          access_type: 'offline',
          prompt: 'select_account consent',
          state,
        });
        return sendJson(res, 200, { url: \`https://accounts.google.com/o/oauth2/v2/auth?\${params.toString()}\` });
      }

      if (req.method === 'GET' && (pathname === '/auth/youtube/callback' || pathname === '/auth/youtube/callback/')) {
        const code = urlObj.searchParams.get('code') || '';
        const state = urlObj.searchParams.get('state') || '';
        const errParam = urlObj.searchParams.get('error') || '';
        const pending = state ? youtubePendingStates.get(state) : undefined;
        if (state) youtubePendingStates.delete(state);
        if (errParam || !code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(\`<html><body style="background:#121214;color:#F4F4F7;font-family:sans-serif;padding:24px;"><p>Google authorization did not complete (\${errParam || 'missing code'}).</p></body></html>\`);
          return;
        }
        const redirectUri = (pending && pending.redirectUri) || \`\${localOrigin}/auth/youtube/callback\`;
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID || '',
            client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
            code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(\`<html><body style="background:#121214;color:#FCA5A5;font-family:sans-serif;padding:24px;"><p>Google token exchange failed: \${tokenData.error_description || tokenData.error || 'Unknown error'}</p></body></html>\`);
          return;
        }
        let name = 'YouTube Creator';
        let email = '';
        let avatarUrl;
        try {
          const uiRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: \`Bearer \${tokenData.access_token}\` },
          });
          if (uiRes.ok) {
            const ui = await uiRes.json();
            name = ui.name || name;
            email = ui.email || '';
            avatarUrl = ui.picture;
          }
        } catch {}

        activeYouTubeSession = {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
          name,
          email,
          avatarUrl,
        };

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(\`<html><body style="background:#121214;color:#F4F4F7;font-family:sans-serif;padding:24px;"><script>
          (function () {
            var msg = { type: 'OAUTH_AUTH_SUCCESS', provider: 'youtube' };
            try { var bc = new BroadcastChannel('chmr_oauth'); bc.postMessage(msg); bc.close(); } catch (e) {}
            if (window.opener) { try { window.opener.postMessage(msg, \${JSON.stringify(localOrigin)}); } catch (e) {} window.close(); }
            else { window.location.replace('/'); }
          })();
        </script><p>YouTube connected for this session. This window will close automatically.</p></body></html>\`);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/auth/youtube/logout') {
        activeYouTubeSession = null;
        return sendJson(res, 200, { ok: true });
      }



      if (pathname.startsWith('/api/ai/')) {
        return sendJson(res, 400, { error: 'Optional AI features require a GEMINI_API_KEY configured in Desktop & Updates.' });
      }

      // Static file serving from ./web or ./dist
      let filePath = path.join(webRoot, pathname === '/' ? 'index.html' : decodeURIComponent(pathname));
      if (!filePath.startsWith(webRoot)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(webRoot, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : 'Local server error' });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(\`CHMR local desktop server running at http://localhost:\${port}\`);
      resolve({ server, port });
    });
  });
}

if (require.main === module) {
  startLocalServer();
}

module.exports = { startLocalServer };
`;

    const mainCjs = `const { app, BrowserWindow, ipcMain, Menu, session } = require('electron');
const path = require('path');
const { startLocalServer } = require('./local-server.cjs');

let localServerRef = null;

// Clean Chromium UA so Google OAuth popups work inside native app windows
app.userAgentFallback = app.userAgentFallback
  .replace(/Electron\\/\\S+\\s*/g, '')
  .replace(/chmr-windows-desktop\\/\\S+\\s*/g, '');

ipcMain.handle('chmr:relaunch', () => {
  app.relaunch();
  app.exit(0);
});

function buildAppMenu(win) {
  const template = [
    {
      label: 'File',
      submenu: [
        { role: 'reload', label: 'Reload Workspace' },
        { type: 'separator' },
        { role: 'quit', label: 'Exit CHMR' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        {
          label: 'Developer Tools',
          accelerator: 'F12',
          click: () => win.webContents.toggleDevTools(),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const dataDir = app.getPath('userData');
  const { server, port } = await startLocalServer(3000, dataDir);
  localServerRef = server;

  const win = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    title: 'CHMR',
    backgroundColor: '#121214',
    darkTheme: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  buildAppMenu(win);

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  // Keep OAuth popups in an ephemeral (non-persistent) partition so individual logins are never saved
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 560,
      height: 720,
      autoHideMenuBar: true,
      backgroundColor: '#121214',
      icon: path.join(__dirname, 'icon.png'),
      webPreferences: {
        partition: 'chmr-oauth-ephemeral',
        contextIsolation: true,
        nodeIntegration: false,
      },
    },
  }));

  win.loadURL(\`http://localhost:\${port}\`);
}

app.whenReady().then(async () => {
  await session.defaultSession.clearStorageData({ storages: ['cookies'] }).catch(() => {});
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'microphone' || permission === 'clipboard-sanitized-write');
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  session.defaultSession.clearStorageData({ storages: ['cookies'] }).catch(() => {});
});

app.on('window-all-closed', () => {
  if (localServerRef) localServerRef.close();
  if (process.platform !== 'darwin') app.quit();
});
`;

    const preloadCjs = `const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chmrDesktop', {
  platform: 'win32',
  isElectron: true,
  isLocalDesktop: true,
  relaunch: () => ipcRenderer.invoke('chmr:relaunch'),
});
`;

    const launchDesktopBat = `@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18+ is required to launch the CHMR desktop workstation.
  echo Download it free from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "node_modules\\electron" (
  echo Installing native desktop runtime (one-time setup)...
  call npm install
  if errorlevel 1 (
    echo Failed to install desktop runtime.
    pause
    exit /b 1
  )
)

start "" /B npm start
`;

    const buildExeBat = `@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18+ is required to compile CHMR Setup.exe.
  echo Download it free from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "node_modules\\electron-builder" (
  echo Installing desktop builder dependencies...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Building CHMR Setup.exe and portable CHMR.exe...
call npm run dist:win
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo Build complete! Check the "dist" folder for CHMR Setup 1.0.0.exe and CHMR.exe.
explorer dist
pause
`;

    const createShortcutBat = `@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\\CHMR.lnk'); $lnk.TargetPath = '%~dp0Launch-CHMR-Desktop.bat'; $lnk.WorkingDirectory = '%~dp0'; if (Test-Path '%~dp0icon.ico') { $lnk.IconLocation = '%~dp0icon.ico' }; $lnk.WindowStyle = 7; $lnk.Save()"
echo Desktop shortcut "CHMR" created on your Windows Desktop!
pause
`;

    const updateBat = `@echo off
setlocal
cd /d "%~dp0"
set "SOURCE_URL=${defaultUpdateOrigin}"
set /p INPUT_URL="Enter update URL [Press Enter for %SOURCE_URL%]: "
if not "%INPUT_URL%"=="" set "SOURCE_URL=%INPUT_URL%"
if "%SOURCE_URL%"=="" (
  echo No update URL provided.
  pause
  exit /b 1
)
echo Downloading latest CHMR update from %SOURCE_URL%/api/desktop/windows-bundle.zip ...
powershell -NoProfile -Command "Invoke-WebRequest -Uri '%SOURCE_URL%/api/desktop/windows-bundle.zip' -OutFile '%~dp0update_tmp.zip'"
if errorlevel 1 (
  echo Update download failed.
  pause
  exit /b 1
)
powershell -NoProfile -Command "Expand-Archive -Path '%~dp0update_tmp.zip' -DestinationPath '%~dp0update_tmp' -Force"
if exist "%~dp0update_tmp\\CHMR-Windows\\web" (
  xcopy "%~dp0update_tmp\\CHMR-Windows\\*" "%~dp0" /E /Y /I >nul
  echo CHMR updated cleanly! Your saved .env and desktop account settings were preserved.
) else (
  echo Update archive did not contain CHMR-Windows files.
)
rmdir /s /q "%~dp0update_tmp" 2>nul
del /q "%~dp0update_tmp.zip" 2>nul
pause
`;

    const localEnvExample = `# Optional local social & AI keys (can also be saved inside CHMR -> Desktop & Updates)
PORT=3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GEMINI_API_KEY=
`;

    return {
      version,
      buildTime,
      localServerCjs,
      mainCjs,
      preloadCjs,
      launchDesktopBat,
      buildExeBat,
      createShortcutBat,
      updateBat,
      localEnvExample,
    };
  }

  // Downloadable 100% Local Native Windows Desktop App (.exe Builder & Electron Launcher)
  app.get('/api/desktop/windows-bundle.zip', (req, res) => {
    const defaultOrigin = getAppBaseUrl(req);
    const assets = buildDesktopRuntimeAssets(defaultOrigin);

    const electronPkg = JSON.stringify(
      {
        name: 'chmr-windows-desktop',
        version: assets.version,
        description: 'CHMR Non-Linear Video Editor — Native Desktop Workstation',
        main: 'main.cjs',
        scripts: {
          start: 'electron .',
          'server:only': 'node local-server.cjs',
          'dist:win': 'electron-builder --win',
        },
        build: {
          appId: 'app.chmr.nle',
          productName: 'CHMR',
          files: ['main.cjs', 'preload.cjs', 'local-server.cjs', 'web/**/*', 'icon.ico', 'icon.png'],
          win: {
            target: [
              { target: 'nsis', arch: ['x64'] },
              { target: 'portable', arch: ['x64'] },
            ],
            icon: 'icon.png',
          },
          nsis: {
            oneClick: false,
            allowToChangeInstallationDirectory: true,
            createDesktopShortcut: true,
            createStartMenuShortcut: true,
          },
        },
        devDependencies: {
          electron: '^33.2.0',
          'electron-builder': '^25.1.8',
        },
      },
      null,
      2
    );

    const readmeTxt = `CHMR — NATIVE WINDOWS DESKTOP WORKSTATION (NO CHROME OR CLOUD BILLING REQUIRED)
================================================================================

OPTION 1: PUT A ONE-CLICK "CHMR" ICON RIGHT ON YOUR WINDOWS DESKTOP
1. Extract this ZIP folder anywhere on your PC (e.g. C:\\CHMR).
2. Double-click "Create-Desktop-Shortcut.bat" to add the CHMR shortcut to your Desktop.
3. Double-click "Launch-CHMR-Desktop.bat" (or your new Desktop shortcut).

OPTION 2: BUILD A STANDALONE WINDOWS INSTALLER (CHMR Setup.exe / CHMR.exe)
Requirements: Node.js 18+ (https://nodejs.org)
1. Double-click "Build-CHMR-Exe.bat".
2. Check the "dist" folder for "CHMR Setup ${assets.version}.exe" and portable "CHMR ${assets.version}.exe".

ACCOUNTS & PUBLISHING LOCALLY (NO GOOGLE CLOUD HOSTING NEEDED)
- Open "Desktop & Updates -> Local Accounts Setup" inside CHMR to save your own
  Google/YouTube Client ID & Secret directly on your PC.
- Callback URL on your desktop:
  * YouTube: http://localhost:3000/auth/youtube/callback

UPDATING ANYTIME WITHOUT GOOGLE CLOUD PUBLISHING
- Inside CHMR Desktop: open "Desktop & Updates -> Updates" and click "Check & Apply Update".
- Or double-click "Update-CHMR-Desktop.bat" while CHMR is closed.
`;

    const entries: Array<{ name: string; data: Buffer }> = [
      { name: 'CHMR-Windows/package.json', data: Buffer.from(electronPkg, 'utf8') },
      { name: 'CHMR-Windows/local-server.cjs', data: Buffer.from(assets.localServerCjs, 'utf8') },
      { name: 'CHMR-Windows/main.cjs', data: Buffer.from(assets.mainCjs, 'utf8') },
      { name: 'CHMR-Windows/preload.cjs', data: Buffer.from(assets.preloadCjs, 'utf8') },
      { name: 'CHMR-Windows/.env.example', data: Buffer.from(assets.localEnvExample, 'utf8') },
      { name: 'CHMR-Windows/Launch-CHMR-Desktop.bat', data: Buffer.from(assets.launchDesktopBat.replace(/\n/g, '\r\n'), 'utf8') },
      { name: 'CHMR-Windows/Build-CHMR-Exe.bat', data: Buffer.from(assets.buildExeBat.replace(/\n/g, '\r\n'), 'utf8') },
      { name: 'CHMR-Windows/Create-Desktop-Shortcut.bat', data: Buffer.from(assets.createShortcutBat.replace(/\n/g, '\r\n'), 'utf8') },
      { name: 'CHMR-Windows/Update-CHMR-Desktop.bat', data: Buffer.from(assets.updateBat.replace(/\n/g, '\r\n'), 'utf8') },
      { name: 'CHMR-Windows/BUILD-EXE-README.txt', data: Buffer.from(readmeTxt.replace(/\n/g, '\r\n'), 'utf8') },
    ];

    const distDir = path.resolve(__dirname, 'dist');
    const appendDirToZip = (dirPath: string, zipPrefix: string) => {
      if (!fs.existsSync(dirPath)) return;
      for (const item of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, item.name);
        const rel = `${zipPrefix}/${item.name}`;
        if (rel.includes('/assets/aistudio')) continue;
        if (item.isDirectory()) {
          appendDirToZip(full, rel);
        } else if (item.isFile()) {
          entries.push({ name: rel, data: fs.readFileSync(full) });
        }
      }
    };
    appendDirToZip(distDir, 'CHMR-Windows/web');

    const icoPath = path.resolve(__dirname, 'public/favicon.ico');
    if (fs.existsSync(icoPath)) {
      entries.push({ name: 'CHMR-Windows/icon.ico', data: fs.readFileSync(icoPath) });
    }
    const pngPath = path.resolve(__dirname, 'public/pwa-512x512.png');
    if (fs.existsSync(pngPath)) {
      entries.push({ name: 'CHMR-Windows/icon.png', data: fs.readFileSync(pngPath) });
    }

    const zipBuffer = buildZipArchive(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="CHMR-Windows-Desktop.zip"');
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.send(zipBuffer);
  });

  // Full Editable Source + Electron Desktop Project (100% offline editing & rebuilding without any cloud servers)
  app.get('/api/desktop/source-bundle.zip', (req, res) => {
    const defaultOrigin = getAppBaseUrl(req);
    const assets = buildDesktopRuntimeAssets(defaultOrigin);

    const rootPkgRaw = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const sourcePkg = JSON.stringify(
      {
        name: 'chmr-source-desktop',
        private: true,
        version: assets.version,
        type: 'module',
        main: 'main.cjs',
        scripts: {
          start: 'electron .',
          dev: 'vite',
          build: 'vite build',
          'server:only': 'node local-server.cjs',
          'dist:win': 'electron-builder --win',
          lint: 'tsc --noEmit',
        },
        dependencies: rootPkgRaw.dependencies || {},
        devDependencies: {
          ...(rootPkgRaw.devDependencies || {}),
          electron: '^33.2.0',
          'electron-builder': '^25.1.8',
        },
        build: {
          appId: 'app.chmr.nle',
          productName: 'CHMR',
          files: ['main.cjs', 'preload.cjs', 'local-server.cjs', 'web/**/*', 'icon.ico', 'icon.png'],
          win: {
            target: [
              { target: 'nsis', arch: ['x64'] },
              { target: 'portable', arch: ['x64'] },
            ],
            icon: 'icon.png',
          },
          nsis: {
            oneClick: false,
            allowToChangeInstallationDirectory: true,
            createDesktopShortcut: true,
            createStartMenuShortcut: true,
          },
        },
      },
      null,
      2
    );

    const rebuildBat = `@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18+ is required. Download from https://nodejs.org
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Building updated CHMR UI from local src/ ...
call npm run build
if errorlevel 1 (
  pause
  exit /b 1
)
if exist "dist" (
  rmdir /s /q "web" 2>nul
  xcopy "dist\\*" "web\\" /E /Y /I >nul
)
echo.
echo Local CHMR build complete! Launch with Launch-CHMR-Desktop.bat or package with Build-CHMR-Exe.bat.
pause
`;

    const readmeSourceTxt = `CHMR — COMPLETE EDITABLE SOURCE & DESKTOP PROJECT (100% OFFLINE / NO CLOUD)
============================================================================

1. READY TO RUN OUT OF THE BOX:
   - Double-click "Create-Desktop-Shortcut.bat" to put CHMR on your Windows Desktop.
   - Double-click "Launch-CHMR-Desktop.bat" to run CHMR immediately.

2. EDIT & UPDATE LOCALLY ANYTIME (NO CLOUD REQUIRED):
   - Edit any React/TypeScript files inside "src\\".
   - Double-click "Rebuild-Local-App.bat" to recompile your changes into "web\\".
   - Optionally double-click "Build-CHMR-Exe.bat" to compile a fresh CHMR Setup.exe.
`;

    const entries: Array<{ name: string; data: Buffer }> = [
      { name: 'CHMR-Source-Desktop/package.json', data: Buffer.from(sourcePkg, 'utf8') },
      { name: 'CHMR-Source-Desktop/local-server.cjs', data: Buffer.from(assets.localServerCjs, 'utf8') },
      { name: 'CHMR-Source-Desktop/main.cjs', data: Buffer.from(assets.mainCjs, 'utf8') },
      { name: 'CHMR-Source-Desktop/preload.cjs', data: Buffer.from(assets.preloadCjs, 'utf8') },
      { name: 'CHMR-Source-Desktop/.env.example', data: Buffer.from(assets.localEnvExample, 'utf8') },
      { name: 'CHMR-Source-Desktop/Launch-CHMR-Desktop.bat', data: Buffer.from(assets.launchDesktopBat.replace(/\n/g, '\r\n'), 'utf8') },
      { name: 'CHMR-Source-Desktop/Rebuild-Local-App.bat', data: Buffer.from(rebuildBat.replace(/\n/g, '\r\n'), 'utf8') },
      { name: 'CHMR-Source-Desktop/Build-CHMR-Exe.bat', data: Buffer.from(assets.buildExeBat.replace(/\n/g, '\r\n'), 'utf8') },
      { name: 'CHMR-Source-Desktop/Create-Desktop-Shortcut.bat', data: Buffer.from(assets.createShortcutBat.replace(/\n/g, '\r\n'), 'utf8') },
      { name: 'CHMR-Source-Desktop/README.txt', data: Buffer.from(readmeSourceTxt.replace(/\n/g, '\r\n'), 'utf8') },
    ];

    for (const rootFile of ['index.html', 'tsconfig.json', 'vite.config.ts', 'firebase-applet-config.json']) {
      const p = path.resolve(__dirname, rootFile);
      if (fs.existsSync(p)) {
        entries.push({ name: `CHMR-Source-Desktop/${rootFile}`, data: fs.readFileSync(p) });
      }
    }

    const appendDirToZip = (dirPath: string, zipPrefix: string) => {
      if (!fs.existsSync(dirPath)) return;
      for (const item of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, item.name);
        const rel = `${zipPrefix}/${item.name}`;
        if (rel.includes('/assets/aistudio')) continue;
        if (item.isDirectory()) {
          appendDirToZip(full, rel);
        } else if (item.isFile()) {
          entries.push({ name: rel, data: fs.readFileSync(full) });
        }
      }
    };
    appendDirToZip(path.resolve(__dirname, 'src'), 'CHMR-Source-Desktop/src');
    appendDirToZip(path.resolve(__dirname, 'public'), 'CHMR-Source-Desktop/public');
    appendDirToZip(path.resolve(__dirname, 'dist'), 'CHMR-Source-Desktop/web');

    const icoPath = path.resolve(__dirname, 'public/favicon.ico');
    if (fs.existsSync(icoPath)) {
      entries.push({ name: 'CHMR-Source-Desktop/icon.ico', data: fs.readFileSync(icoPath) });
    }
    const pngPath = path.resolve(__dirname, 'public/pwa-512x512.png');
    if (fs.existsSync(pngPath)) {
      entries.push({ name: 'CHMR-Source-Desktop/icon.png', data: fs.readFileSync(pngPath) });
    }

    const zipBuffer = buildZipArchive(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="CHMR-Full-Source-Desktop.zip"');
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.send(zipBuffer);
  });

  app.get('/api/local/config', (req, res) => {
    res.json({
      isLocalServer: false,
      version: '1.1.0',
      origin: getAppBaseUrl(req),
      youtubeCallbackUrl: 'http://localhost:3000/auth/youtube/callback',
    });
  });

  // 1. AI Editing Assistant (natural language -> executable timeline actions)
  app.post('/api/ai/assistant', async (req, res) => {
    try {
      const { prompt, clipsSummary, assetsSummary, playhead, sequence } = req.body as {
        prompt: string;
        clipsSummary: unknown[];
        assetsSummary: unknown[];
        playhead: number;
        sequence: { name: string; width: number; height: number; fps: number };
      };

      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: 'Prompt is required.' });
      }

      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `You are an expert Adobe Premiere Pro AI Editing Assistant inside the CHMR NLE workstation.
Current Sequence: ${JSON.stringify(sequence)}
Playhead Time: ${playhead.toFixed(2)}s
Project Bin Assets: ${JSON.stringify(assetsSummary)}
Current Timeline Clips: ${JSON.stringify(clipsSummary)}

User Request: "${prompt}"

Analyze the user's request and return a concise explanation plus a list of structured editing actions to execute on the timeline. Only include actions relevant to the user's request.`,
        config: {
          systemInstruction:
            'Return JSON matching the schema. Supported action types: split_at_playhead, add_marker, apply_color_preset (presetId: natural|teal-orange|noir|kodak|nordic-cool|bleach-bypass), auto_color, set_label_color (label: violet|cerulean|forest|amber|rose), rename_clip (name), create_title (text, subtitle, layout: center-title|lower-third|caption), apply_transition (edge: in|out, transitionType: cross-dissolve|dip-to-black|dip-to-white|slide-left|wipe-right|zoom-in), auto_reframe (aspect: 16:9|9:16|1:1|4:5), duck_music, assemble_rough_cut, add_adjustment_layer.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: { type: Type.STRING, description: 'Concise assistant reply summarizing edits made.' },
              actions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING },
                    clipId: { type: Type.STRING },
                    presetId: { type: Type.STRING },
                    label: { type: Type.STRING },
                    name: { type: Type.STRING },
                    text: { type: Type.STRING },
                    subtitle: { type: Type.STRING },
                    layout: { type: Type.STRING },
                    edge: { type: Type.STRING },
                    transitionType: { type: Type.STRING },
                    aspect: { type: Type.STRING },
                    time: { type: Type.NUMBER },
                  },
                },
              },
            },
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json({
        reply: parsed.reply || 'Edits applied to your sequence.',
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI Assistant request failed.';
      res.status(500).json({ error: message });
    }
  });

  // 2. Speech-to-Text Transcription & Filler/Pause Detection
  app.post('/api/ai/transcribe', async (req, res) => {
    try {
      const { audioBase64, mimeType, duration } = req.body as {
        audioBase64: string;
        mimeType: string;
        duration?: number;
      };

      if (!audioBase64) {
        return res.status(400).json({ error: 'Audio payload is required.' });
      }

      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType || 'audio/wav',
                data: audioBase64,
              },
            },
            {
              text: `Transcribe this audio cleanly with speaker labels and timestamps across its ${duration ? duration.toFixed(1) : 'total'}s duration. Also note any filler words like um, uh, like.`,
            },
          ],
        },
      });

      const rawText = (response.text ?? '').trim();

      // Structure into timed transcript segments using gemini-4-hydrogen
      const structRes = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Convert this transcript into timed subtitle segments spanning 0 to ${duration || 15} seconds. Detect any filler words ("um", "uh", "like", "you know") or silent pauses.\n\nTranscript:\n${rawText}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              segments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    speaker: { type: Type.STRING },
                    start: { type: Type.NUMBER },
                    end: { type: Type.NUMBER },
                    text: { type: Type.STRING },
                    hasFiller: { type: Type.BOOLEAN },
                  },
                },
              },
            },
          },
        },
      });

      const parsed = JSON.parse((structRes.text ?? '{"segments":[]}').trim());
      res.json({
        rawText,
        segments: Array.isArray(parsed.segments) ? parsed.segments : [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transcription failed.';
      res.status(500).json({ error: message });
    }
  });

  // 3. Caption Translation
  app.post('/api/ai/translate-captions', async (req, res) => {
    try {
      const { segments, targetLanguage } = req.body as {
        segments: Array<{ id: string; text: string }>;
        targetLanguage: string;
      };
      if (!Array.isArray(segments) || !targetLanguage) {
        return res.status(400).json({ error: 'Segments and targetLanguage are required.' });
      }

      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Translate the following video captions naturally into ${targetLanguage}, keeping concise subtitle phrasing.\n\n${JSON.stringify(segments)}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              translated: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    text: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{"translated":[]}').trim());
      res.json({ translated: parsed.translated || [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Caption translation failed.';
      res.status(500).json({ error: message });
    }
  });

  // 4. Studio Voiceover / Narration TTS Generation
  app.post('/api/ai/voiceover-tts', async (req, res) => {
    try {
      const { script, voiceName = 'Kore', style = 'Warm documentary narrator' } = req.body as {
        script: string;
        voiceName?: string;
        style?: string;
      };
      if (!script || !script.trim()) {
        return res.status(400).json({ error: 'Narration script is required.' });
      }

      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: script.trim(),
                speechMetadata: { style },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        return res.status(502).json({ error: 'No audio data returned from speech model.' });
      }

      res.json({ audioBase64: base64Audio, mimeType: 'audio/wav' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Voiceover generation failed.';
      res.status(500).json({ error: message });
    }
  });

  // 5. Media Intelligence Semantic Search
  app.post('/api/ai/media-search', async (req, res) => {
    try {
      const { query, assets } = req.body as {
        query: string;
        assets: Array<{ id: string; name: string; type: string; tags?: string[]; notes?: string }>;
      };
      if (!query) return res.json({ matchedIds: assets.map((a) => a.id) });

      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Rank and return matching asset IDs for search query: "${query}".\nAssets: ${JSON.stringify(assets)}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              matchedIds: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{"matchedIds":[]}').trim());
      res.json({ matchedIds: Array.isArray(parsed.matchedIds) ? parsed.matchedIds : [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Media Intelligence search failed.';
      res.status(500).json({ error: message });
    }
  });

  const httpServer = http.createServer(app);

  // Vite middleware in dev, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
        hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`CHMR workstation server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
