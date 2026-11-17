// The only things the window can ask the main process for.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installer', {
    state: () => ipcRenderer.invoke('state'),
    install: (ids) => ipcRenderer.invoke('install', ids),
    stop: () => ipcRenderer.invoke('stop'),
    chooseFolder: () => ipcRenderer.invoke('chooseFolder'),
    openResolve: () => ipcRenderer.invoke('openResolve'),
    restartResolve: () => ipcRenderer.invoke('restartResolve'),
    showFolder: () => ipcRenderer.invoke('showFolder'),
    openLink: (url) => ipcRenderer.invoke('openLink', url),
    onProgress: (fn) => ipcRenderer.on('progress', (e, msg) => fn(msg)),
});
