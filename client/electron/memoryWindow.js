// Persona desktop shell — memory viewer window.
//
// A small dark-glass window that lists Violet's long-term memories and
// lets Hamza search, edit, delete, or reset them. All HTTP to the api
// happens here in the main process (Node global fetch — no renderer
// CORS), exposed to the page through memoryPreload.js over IPC.

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Backend api base — hardcoded localhost to match the renderer's other
// service URLs. Revisit when the backend is remotely hosted.
const API_BASE = 'http://localhost:8000';

let _win = null;

async function _api(pathname, opts) {
  try {
    const res = await fetch(`${API_BASE}${pathname}`, opts);
    return await res.json();
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

// IPC surface for the memory window. Registered once at module load.
// ipcMain.handle is idempotent enough for our single-window use; the
// module is required exactly once via tray.js.
ipcMain.handle('memory:list', () => _api('/memory'));

ipcMain.handle('memory:search', (_e, q) =>
  _api(`/memory/search?q=${encodeURIComponent(q)}&k=100`)
);

ipcMain.handle('memory:delete', (_e, id) =>
  _api(`/memory/${id}`, { method: 'DELETE' })
);

ipcMain.handle('memory:update', (_e, id, patch) =>
  _api(`/memory/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
);

ipcMain.handle('memory:add', (_e, body) =>
  _api('/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
);

ipcMain.handle('memory:reset', () =>
  _api('/memory/reset', { method: 'POST' })
);

// Scheduled tasks (events + reminders) — same window, separate pane.
ipcMain.handle('events:list', () => _api('/events'));

ipcMain.handle('events:cancel', (_e, id) =>
  _api(`/events/${id}`, { method: 'DELETE' })
);

ipcMain.on('memory:close', () => {
  if (_win && !_win.isDestroyed()) _win.close();
});

function createMemoryWindow() {
  if (_win && !_win.isDestroyed()) {
    _win.focus();
    return;
  }

  _win = new BrowserWindow({
    width: 480,
    height: 640,
    minWidth: 380,
    minHeight: 420,
    frame: false,
    resizable: true,
    skipTaskbar: false,
    backgroundColor: '#0d0d0f',
    title: 'Memory',
    webPreferences: {
      preload: path.join(__dirname, 'memoryPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  _win.loadFile(path.join(__dirname, 'memoryView.html'));
  _win.on('closed', () => { _win = null; });
}

module.exports = { createMemoryWindow };
