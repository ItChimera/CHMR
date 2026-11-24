const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const pkgPath = path.join(__dirname, 'package.json');
const CHMR_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '1.1.0';
  } catch {
    return '1.1.0';
  }
})();
const CHMR_BUILD_TIME = new Date().toISOString();

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
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
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
loadDotEnv(path.join(__dirname, '..', '.env'));
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

function scrubLegacySavedSessions() {
  try {
    const cfgPath = getConfigFilePath();
    if (!fs.existsSync(cfgPath)) return;
    const cfg = readLocalConfig();
    if ('savedYouTubeSession' in cfg) {
      delete cfg.savedYouTubeSession;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
    }
  } catch {
    // ignore cleanup errors
  }
}

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



function resolveWebRoot() {
  const candidates = [
    path.join(__dirname, 'web'),
    path.join(__dirname, '..', 'dist'),
    path.join(__dirname, 'dist'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  return candidates[0];
}

function startLocalServer(preferredPort = Number(process.env.PORT || 3000), dataDirOverride) {
  if (dataDirOverride) {
    activeDataDir = dataDirOverride;
    applySavedEnvOverrides();
  }
  scrubLegacySavedSessions();
  const webRoot = resolveWebRoot();
  let boundPort = preferredPort;

  const server = http.createServer(async (req, res) => {
    try {
      const localOrigin = `http://localhost:${boundPort}`;
      const urlObj = new URL(req.url || '/', localOrigin);
      const pathname = urlObj.pathname;

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
          hasLocalSource: fs.existsSync(path.join(__dirname, '..', 'src', 'App.tsx')),
          updateOrigin: cfg.updateOrigin || '',
          googleClientId: process.env.GOOGLE_CLIENT_ID || '',
          googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
          geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
          youtubeCallbackUrl: `${localOrigin}/auth/youtube/callback`,
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
        if (typeof body.updateOrigin === 'string') patch.updateOrigin = body.updateOrigin.trim().replace(/\/$/, '');
        writeLocalConfig(patch);
        return sendJson(res, 200, { ok: true });
      }

      // Local YouTube Loopback OAuth
      if (req.method === 'GET' && pathname === '/api/auth/youtube/status') {
        const configured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
        const session = configured ? await resolveValidYouTubeSession() : null;
        return sendJson(res, 200, {
          isLocalServer: true,
          configured,
          connected: Boolean(session),
          callbackUrl: `${localOrigin}/auth/youtube/callback`,
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
        const redirectUri = `${localOrigin}/auth/youtube/callback`;
        if (!clientId || !clientSecret) {
          return sendJson(res, 400, {
            error: 'Add your Google OAuth Client ID and Secret in Desktop & Updates -> Local Accounts first.',
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
        return sendJson(res, 200, { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
      }

      if (req.method === 'GET' && (pathname === '/auth/youtube/callback' || pathname === '/auth/youtube/callback/')) {
        const code = urlObj.searchParams.get('code') || '';
        const state = urlObj.searchParams.get('state') || '';
        const errParam = urlObj.searchParams.get('error') || '';
        const pending = state ? youtubePendingStates.get(state) : undefined;
        if (state) youtubePendingStates.delete(state);
        if (errParam || !code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<html><body style="background:#121214;color:#F4F4F7;font-family:sans-serif;padding:24px;"><p>Google authorization did not complete (${errParam || 'missing code'}).</p></body></html>`);
          return;
        }
        const redirectUri = (pending && pending.redirectUri) || `${localOrigin}/auth/youtube/callback`;
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
          res.end(`<html><body style="background:#121214;color:#FCA5A5;font-family:sans-serif;padding:24px;"><p>Google token exchange failed: ${tokenData.error_description || tokenData.error || 'Unknown error'}</p></body></html>`);
          return;
        }
        let name = 'YouTube Creator';
        let email = '';
        let avatarUrl;
        try {
          const uiRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          });
          if (uiRes.ok) {
            const ui = await uiRes.json();
            name = ui.name || name;
            email = ui.email || '';
            avatarUrl = ui.picture;
          }
        } catch {
          // ignore userinfo failure
        }

        activeYouTubeSession = {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
          name,
          email,
          avatarUrl,
        };

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="background:#121214;color:#F4F4F7;font-family:sans-serif;padding:24px;"><script>
          (function () {
            var msg = { type: 'OAUTH_AUTH_SUCCESS', provider: 'youtube' };
            try { var bc = new BroadcastChannel('chmr_oauth'); bc.postMessage(msg); bc.close(); } catch (e) {}
            if (window.opener) { try { window.opener.postMessage(msg, ${JSON.stringify(localOrigin)}); } catch (e) {} window.close(); }
            else { window.location.replace('/'); }
          })();
        </script><p>YouTube connected for this session. This window will close automatically.</p></body></html>`);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/auth/youtube/logout') {
        activeYouTubeSession = null;
        return sendJson(res, 200, { ok: true });
      }



      if (pathname.startsWith('/api/ai/')) {
        return sendJson(res, 400, {
          error: 'Optional AI features require running the local Gemini proxy server or configuring GEMINI_API_KEY.',
        });
      }

      // Static file serving from ./web or ../dist
      const resolvedWebRoot = path.resolve(webRoot);
      let filePath = path.resolve(
        resolvedWebRoot,
        pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
      );
      if (filePath !== resolvedWebRoot && !filePath.startsWith(resolvedWebRoot + path.sep)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(resolvedWebRoot, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : 'Local server error' });
    }
  });

  return new Promise((resolve, reject) => {
    const tryListen = (portToTry) => {
      server.once('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && portToTry !== 0) {
          tryListen(0);
        } else {
          reject(err);
        }
      });
      server.listen(portToTry, '127.0.0.1', () => {
        const addr = server.address();
        boundPort = typeof addr === 'object' && addr ? addr.port : portToTry;
        console.log(`CHMR desktop runtime listening at http://localhost:${boundPort}`);
        resolve({ server, port: boundPort });
      });
    };
    tryListen(preferredPort);
  });
}

if (require.main === module) {
  startLocalServer();
}

module.exports = { startLocalServer };
