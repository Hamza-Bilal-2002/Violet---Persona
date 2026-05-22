// Persona desktop shell — config.
//
// Constants and paths used by main / window / tray / ipc. Keeping
// them in one module means there is exactly one place to read the
// agent identity, one place to compute install-relative paths, and
// one place to decide whether we are in dev mode.

const path = require('path');
const { app } = require('electron');

// ----------------------------------------------------------------------
// Agent identity (single source of truth at config/agent.json).
// ----------------------------------------------------------------------

let agentConfig = {
  name: 'Violet',
  userName: 'Hamza',
};

try {

  agentConfig = require('../config/agent.json');

} catch (e) {

  console.warn(
    '[shell] failed to load config/agent.json — using defaults:',
    e.message
  );

}

const AGENT_NAME = agentConfig.name || 'Violet';

// ----------------------------------------------------------------------
// Dev vs production.
// ----------------------------------------------------------------------

const IS_DEV =
  process.env.NODE_ENV === 'development' ||
  process.argv.includes('--dev') ||
  !app.isPackaged;

const DEV_URL = 'http://localhost:5173';

// ----------------------------------------------------------------------
// Paths.
// ----------------------------------------------------------------------

const PROD_INDEX = path.join(
  __dirname,
  '..',
  'frontend',
  'dist',
  'index.html'
);

const TRAY_ICON_PATH = path.join(
  __dirname,
  'assets',
  'tray-icon.png'
);

const PRELOAD_PATH = path.join(
  __dirname,
  'preload.js'
);

module.exports = {
  AGENT_NAME,
  IS_DEV,
  DEV_URL,
  PROD_INDEX,
  TRAY_ICON_PATH,
  PRELOAD_PATH,
};
