const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chmrDesktop', {
  platform: process.platform,
  isElectron: true,
  isLocalDesktop: true,
  relaunch: () => ipcRenderer.invoke('chmr:relaunch'),
});
