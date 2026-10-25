const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('phone', {
  devices: () => ipcRenderer.invoke('devices'),
  connect: serial => ipcRenderer.invoke('connect', serial),
  snapshot: serial => ipcRenderer.invoke('snapshot', serial),
  icons: (serial, packages) => ipcRenderer.invoke('icons', serial, packages),
  packages: serial => ipcRenderer.invoke('packages', serial),
  history: () => ipcRenderer.invoke('history'),
  theme: value => ipcRenderer.invoke('theme', value),
  action: request => ipcRenderer.invoke('action', request),
  undo: id => ipcRenderer.invoke('undo', id),
  window: action => ipcRenderer.send('window', action)
});
