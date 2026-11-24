const { app, BrowserWindow, ipcMain, Menu, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { startLocalServer } = require('./local-server.cjs');

let localServerRef = null;

// Clean Chromium UA so Google OAuth popups work inside native app windows
app.userAgentFallback = app.userAgentFallback
  .replace(/Electron\/\S+\s*/g, '')
  .replace(/chmr-desktop\/\S+\s*/g, '');

ipcMain.handle('chmr:relaunch', () => {
  app.relaunch();
  app.exit(0);
});

function resolveAppIcon() {
  const candidates = [
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, '..', 'public', 'pwa-512x512.png'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function buildAppMenu(win) {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { role: 'reload', label: 'Reload Workspace' },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Close Window' } : { role: 'quit', label: 'Exit CHMR' },
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
          accelerator: isMac ? 'Alt+Command+I' : 'F12',
          click: () => win.webContents.toggleDevTools(),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const dataDir = app.getPath('userData');
  const { server, port } = await startLocalServer(Number(process.env.PORT || 3000), dataDir);
  localServerRef = server;

  const iconPath = resolveAppIcon();
  const win = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: 'CHMR — Non-Linear Video Editor',
    backgroundColor: '#121214',
    darkTheme: true,
    ...(iconPath ? { icon: iconPath } : {}),
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
      center: true,
      autoHideMenuBar: true,
      backgroundColor: '#121214',
      ...(iconPath ? { icon: iconPath } : {}),
      webPreferences: {
        partition: 'chmr-oauth-ephemeral',
        contextIsolation: true,
        nodeIntegration: false,
      },
    },
  }));

  win.loadURL(`http://localhost:${port}`);
}

app.whenReady().then(async () => {
  // Always start with zero persisted auth cookies so each user signs in fresh if needed
  await session.defaultSession.clearStorageData({ storages: ['cookies'] }).catch(() => {});
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(
      permission === 'media' ||
        permission === 'microphone' ||
        permission === 'clipboard-sanitized-write'
    );
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
