// Preload for the memory viewer window. Exposes a minimal, explicit
// memory API on window.memoryApi so the page can read/edit memories
// without node access or direct network (HTTP runs in the main process).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memoryApi', {
  list:   ()           => ipcRenderer.invoke('memory:list'),
  search: (q)          => ipcRenderer.invoke('memory:search', q),
  remove: (id)         => ipcRenderer.invoke('memory:delete', id),
  update: (id, patch)  => ipcRenderer.invoke('memory:update', id, patch),
  add:    (body)       => ipcRenderer.invoke('memory:add', body),
  reset:  ()           => ipcRenderer.invoke('memory:reset'),
  close:  ()           => ipcRenderer.send('memory:close'),

  // Scheduled tasks (events + reminders).
  events:       ()     => ipcRenderer.invoke('events:list'),
  cancelEvent:  (id)   => ipcRenderer.invoke('events:cancel', id),
});
