// WhatsApp message sender via whatsapp-web.js.
//
// Session is stored in Electron userData and survives restarts.
// QR codes are shown as a scannable image in a small popup window
// (not in the terminal) via the 'qr' event on the status emitter.
//
// Contact resolution:
//   - If `to` is a phone number (digits, +, -, spaces) → formats as WA chat ID
//   - Otherwise does a case-insensitive partial name search in your contacts

const path = require('path');
const { EventEmitter } = require('events');

const _emitter = new EventEmitter();

let _client      = null;
let _ready       = false;
let _initPromise = null;
let _status      = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'

function _setStatus(s) {
  _status = s;
  _emitter.emit('status', s);
}

function getStatus() {
  return _status;
}

function onStatusChange(fn) {
  _emitter.on('status', fn);
}

function onQr(fn) {
  _emitter.on('qr', fn);
}

function init() {
  if (_initPromise) return _initPromise;

  _setStatus('connecting');

  _initPromise = new Promise((resolve, reject) => {
    let Client, LocalAuth;
    try {
      ({ Client, LocalAuth } = require('whatsapp-web.js'));
    } catch {
      _setStatus('disconnected');
      return reject(new Error(
        'whatsapp-web.js not installed — run: cd electron && npm install'
      ));
    }

    const { app } = require('electron');
    const sessionPath = path.join(app.getPath('userData'), 'whatsapp-session');

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: sessionPath }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      },
    });

    client.on('qr', (qr) => {
      console.log('[WhatsApp] QR code received — showing popup window');
      _emitter.emit('qr', qr);
    });

    client.on('authenticated', () => {
      console.log('[WhatsApp] Authenticated.');
    });

    client.on('ready', () => {
      console.log('[WhatsApp] Ready — messages can now be sent.');
      _ready  = true;
      _client = client;
      _setStatus('connected');
      _emitter.emit('qr-done'); // signal QR window to close
      resolve(client);
    });

    client.on('auth_failure', (msg) => {
      _initPromise = null;
      _setStatus('disconnected');
      reject(new Error(`WhatsApp auth failed: ${msg}`));
    });

    client.on('disconnected', (reason) => {
      console.warn('[WhatsApp] Disconnected:', reason);
      _ready       = false;
      _client      = null;
      _initPromise = null;
      _setStatus('disconnected');
    });

    client.initialize().catch((err) => {
      _initPromise = null;
      _setStatus('disconnected');
      reject(err);
    });
  });

  _initPromise.catch(() => {
    _initPromise = null;
    _setStatus('disconnected');
  });

  return _initPromise;
}

async function disconnect() {
  if (_client) {
    try { await _client.logout(); } catch { /* already logged out */ }
    try { await _client.destroy(); } catch { /* already destroyed */ }
  }
  _client      = null;
  _ready       = false;
  _initPromise = null;
  _setStatus('disconnected');
}

async function sendWhatsApp({ to, message }) {
  if (!to || !message) {
    throw new Error('send_whatsapp requires both "to" and "message"');
  }

  const client = await init();

  let chatId;

  if (/^[\d\s+\-()\\.]+$/.test(to.trim())) {
    const digits = to.replace(/\D/g, '');
    chatId = `${digits}@c.us`;
  } else {
    const contacts = await client.getContacts();
    const needle   = to.toLowerCase();
    const match    = contacts.find(
      (c) => c.name && c.name.toLowerCase().includes(needle)
    );
    if (!match) {
      throw new Error(
        `WhatsApp contact not found: "${to}". ` +
        `Try their phone number (e.g. +923001234567) instead.`
      );
    }
    chatId = match.id._serialized;
  }

  await client.sendMessage(chatId, message);
  return { sent: true, to, message };
}

// Resolve a contact by name or phone number without sending.
// Returns { chatId, name, profilePicUrl }.

async function resolveContact(to) {
  if (!to) throw new Error('resolveContact requires a "to" argument');

  const client = await init();

  if (/^[\d\s+\-()\\.]+$/.test(to.trim())) {
    const digits = to.replace(/\D/g, '');
    const chatId  = `${digits}@c.us`;
    let name = to;
    let profilePicUrl = null;
    try {
      const contact = await client.getContactById(chatId);
      name = contact.pushname || contact.name || to;
    } catch { /* unknown number — use raw input as name */ }
    try { profilePicUrl = await client.getProfilePicUrl(chatId); } catch { /* no pic */ }
    return { chatId, name, profilePicUrl };
  }

  const contacts = await client.getContacts();
  const needle   = to.toLowerCase();
  const match    = contacts.find(
    (c) => c.name && c.name.toLowerCase().includes(needle)
  );
  if (!match) {
    throw new Error(
      `WhatsApp contact not found: "${to}". ` +
      `Try their phone number (e.g. +923001234567) instead.`
    );
  }
  let profilePicUrl = null;
  try { profilePicUrl = await client.getProfilePicUrl(match.id._serialized); } catch { /* no pic */ }
  return { chatId: match.id._serialized, name: match.name || to, profilePicUrl };
}

module.exports = {
  sendWhatsApp,
  resolveContact,
  init,
  disconnect,
  getStatus,
  onStatusChange,
  onQr,
  _emitter,
};
