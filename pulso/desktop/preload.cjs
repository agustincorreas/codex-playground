// Puente seguro entre las páginas de la app de escritorio (claves, pantalla de carga) y el proceso principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulso', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  useDemo: () => ipcRenderer.invoke('settings:demo'),
  openSetup: () => ipcRenderer.invoke('setup:open'),
  restartServer: () => ipcRenderer.invoke('server:restart'),
  openLog: () => ipcRenderer.invoke('log:open'),
  getLog: () => ipcRenderer.invoke('log:get'),
  onLog: (cb) => ipcRenderer.on('log', (_e, line) => cb(line)),
});
