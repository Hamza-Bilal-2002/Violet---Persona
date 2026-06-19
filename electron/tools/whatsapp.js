// WhatsApp message sender via whatsapp-web.js.
//
// First run: a QR code appears in the Electron terminal — scan it with
// the WhatsApp app on your phone (Linked Devices → Link a Device).
// The session is stored in Electron userData and survives restarts so
// you only scan once.
//
// Contact resolution:
//   - If `to` is a phone number (digits, +, -, spaces) → formats as WA chat ID
//   - Otherwise does a case-insensitive partial name search in your contacts

const path = require('path');

let _client   = null;
let _ready    = false;
let _initPromise = null;

function init() {
  if (_initPromise) return _initPromise;

  _initPromise = new Promise((resolve, reject) => {
    let Client, LocalAuth;
    try {
      ({ Client, LocalAuth } = require('whatsapp-web.js'));
    } catch {
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
      console.log('\n[WhatsApp] ─────────────────────────────────────');
      console.log('[WhatsApp] Scan this QR code to link your account:');
      console.log('[WhatsApp] ─────────────────────────────────────\n');
      try {
        require('qrcode-terminal').generate(qr, { small: true });
      } catch {
        // qrcode-terminal not installed — print raw string
        console.log('[WhatsApp] QR data (paste into qr-code decoder):\n', qr);
      }
      console.log('\n[WhatsApp] Waiting for scan...\n');
    });

    client.on('authenticated', () => {
      console.log('[WhatsApp] Authenticated.');
    });

    client.on('ready', () => {
      console.log('[WhatsApp] Ready — messages can now be sent.');
      _ready  = true;
      _client = client;
      resolve(client);
    });

    client.on('auth_failure', (msg) => {
      _initPromise = null;
      reject(new Error(`WhatsApp auth failed: ${msg}`));
    });

    client.on('disconnected', (reason) => {
      console.warn('[WhatsApp] Disconnected:', reason);
      _ready       = false;
      _client      = null;
      _initPromise = null;
    });

    client.initialize().catch((err) => {
      _initPromise = null;
      reject(err);
    });
  });

  _initPromise.catch(() => { _initPromise = null; });
  return _initPromise;
}

async function sendWhatsApp({ to, message }) {
  if (!to || !message) {
    throw new Error('send_whatsapp requires both "to" and "message"');
  }

  const client = await init();

  let chatId;

  if (/^[\d\s+\-()\\.]+$/.test(to.trim())) {
    // Phone number — strip everything except digits
    const digits = to.replace(/\D/g, '');
    chatId = `${digits}@c.us`;
  } else {
    // Contact name — case-insensitive partial match
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

module.exports = { sendWhatsApp, init };
