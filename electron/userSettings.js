// Persistent user settings — read/write JSON from Electron userData.
//
// Stored at: <userData>/violet-settings.json
// Shape mirrors the sections of AVATAR_CONFIG that the user can
// tune via the debug GUI (lighting, camera, viewport position).
// Missing keys fall back to avatarConfig.js defaults at runtime.

'use strict';

const { app } = require('electron');
const fs      = require('fs');
const path    = require('path');

const SETTINGS_PATH = path.join(
  app.getPath('userData'),
  'violet-settings.json'
);

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    }
  } catch (err) {
    console.warn('[settings] load failed:', err.message);
  }
  return null;
}

function saveSettings(data) {
  try {
    fs.writeFileSync(
      SETTINGS_PATH,
      JSON.stringify(data, null, 2),
      'utf8'
    );
    console.log('[settings] saved to', SETTINGS_PATH);
  } catch (err) {
    console.error('[settings] save failed:', err.message);
  }
}

module.exports = { loadSettings, saveSettings };
