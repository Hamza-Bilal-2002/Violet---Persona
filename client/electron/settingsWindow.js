// Persona desktop shell — offline mode settings window.
//
// A small dark-glass window for configuring the Tier-2 client fallback:
// which cloud provider to use when the backend is unreachable (OpenAI or
// Gemini) and the API keys for each. Same pattern as memoryWindow.js.

'use strict';

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { loadSettings, saveSettings } = require('./userSettings');

let _win = null;

ipcMain.handle('settings-win:load', () => {
  const s = loadSettings() || {};
  return {
    fallbackProvider: s.fallbackProvider || 'openai',
    openaiApiKey:     s.openaiApiKey     || '',
    geminiApiKey:     s.geminiApiKey     || '',
  };
});

ipcMain.handle('settings-win:save', (_e, patch) => {
  const current = loadSettings() || {};
  saveSettings({ ...current, ...patch });
  return { ok: true };
});

ipcMain.on('settings-win:close', () => {
  if (_win && !_win.isDestroyed()) _win.close();
});

function createSettingsWindow() {
  if (_win && !_win.isDestroyed()) {
    _win.focus();
    return;
  }

  _win = new BrowserWindow({
    width: 400,
    height: 380,
    resizable: false,
    frame: false,
    skipTaskbar: false,
    backgroundColor: '#0d0d0f',
    title: 'Offline Mode Settings',
    webPreferences: {
      preload: path.join(__dirname, 'settingsPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  _win.loadFile(path.join(__dirname, 'settingsView.html'));
  _win.on('closed', () => { _win = null; });
}

module.exports = { createSettingsWindow };
