'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsShell', {
  load:  ()       => ipcRenderer.invoke('settings-win:load'),
  save:  (patch)  => ipcRenderer.invoke('settings-win:save', patch),
  close: ()       => ipcRenderer.send('settings-win:close'),
});
