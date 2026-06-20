'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsShell', {
  // State
  load:   ()            => ipcRenderer.invoke('settings:load'),
  status: ()            => ipcRenderer.invoke('settings:status'),

  // Behavior
  toggle:     (key, value) => ipcRenderer.invoke('settings:toggle', { key, value }),
  setDefault: (key, value) => ipcRenderer.invoke('settings:set-default', { key, value }),

  // Connectivity
  waConnect:        () => ipcRenderer.invoke('settings:wa-connect'),
  waDisconnect:     () => ipcRenderer.invoke('settings:wa-disconnect'),
  spotifyConnect:   () => ipcRenderer.invoke('settings:spotify-connect'),
  spotifyDisconnect:() => ipcRenderer.invoke('settings:spotify-disconnect'),

  // Memory
  memoryView:  () => ipcRenderer.send('settings:memory-view'),
  memoryReset: () => ipcRenderer.invoke('settings:memory-reset'),

  // Avatar tuning
  tuneGet:  ()       => ipcRenderer.invoke('settings:tune-get'),
  tuneSet:  (change) => ipcRenderer.invoke('settings:tune-set', change),
  tuneSave: ()       => ipcRenderer.invoke('settings:tune-save'),

  // Offline mode
  saveOffline: (patch) => ipcRenderer.invoke('settings:save-offline', patch),

  // System
  pinTaskbar: () => ipcRenderer.invoke('settings:pin-taskbar'),

  close: () => ipcRenderer.send('settings:close'),
});
