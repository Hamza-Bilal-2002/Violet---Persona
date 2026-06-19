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

const PHONE_RE = /^[\d\s+\-()\\.]+$/;

function _escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Send a WhatsApp message. Prefers an explicit `chatId` (resolved and
// confirmed via the frontend picker) so the message goes to EXACTLY the
// contact the user approved. Falls back to resolving `to` only when no
// chatId is supplied (e.g. a direct call that skipped confirmation).
//
// Always targets a verified WhatsApp chat id. A bare `<digits>@c.us` for
// a number that isn't on WhatsApp makes sendMessage report success
// without delivering — getNumberId() guards against that silent failure.

async function sendWhatsApp({ to, message, chatId }) {
  if (!message) {
    throw new Error('send_whatsapp requires a "message"');
  }

  const client = await init();

  let targetId = chatId;

  if (!targetId) {
    if (!to) {
      throw new Error('send_whatsapp requires "to" or "chatId"');
    }

    if (PHONE_RE.test(to.trim())) {
      const digits   = to.replace(/\D/g, '');
      const numberId = await client.getNumberId(digits);
      if (!numberId) {
        throw new Error(`${to} is not a WhatsApp number.`);
      }
      targetId = numberId._serialized;
    } else {
      const { matches } = await resolveContact(to);
      if (!matches.length) {
        throw new Error(
          `WhatsApp contact not found: "${to}". ` +
          `Try their phone number (e.g. +923001234567) instead.`
        );
      }
      targetId = matches[0].chatId;
    }
  }

  await client.sendMessage(targetId, message);
  return { sent: true, to, chatId: targetId, message };
}

// Resolve a contact (or contacts) by name or phone number without
// sending. Returns { query, matches: [{ chatId, name, number,
// profilePicUrl }] } ranked best-first. The frontend shows a picker
// when more than one matches, so the user disambiguates between
// multiple "Ahmed" entries before confirming the send.

async function resolveContact(to) {
  if (!to) throw new Error('resolveContact requires a "to" argument');

  const client = await init();

  // ── Phone number path ──────────────────────────────────────────────
  if (PHONE_RE.test(to.trim())) {
    const digits = to.replace(/\D/g, '');

    let numberId = null;
    try { numberId = await client.getNumberId(digits); } catch { /* offline */ }

    if (!numberId) {
      return { query: to, matches: [] }; // not on WhatsApp
    }

    const chatId = numberId._serialized;
    let name   = `+${digits}`;
    let number = `+${digits}`;
    let profilePicUrl = null;
    try {
      const contact = await client.getContactById(chatId);
      name   = contact.pushname || contact.name || name;
      number = contact.number ? `+${contact.number}` : number;
    } catch { /* unknown number — keep raw */ }
    try { profilePicUrl = await client.getProfilePicUrl(chatId); } catch { /* no pic */ }

    return { query: to, matches: [{ chatId, name, number, profilePicUrl }] };
  }

  // ── Name path ──────────────────────────────────────────────────────
  const needle   = to.toLowerCase().trim();
  const wordRe   = new RegExp(`\\b${_escapeRegex(needle)}`);
  const contacts = await client.getContacts();

  // Only real, individual WhatsApp users with a usable name. Score each
  // by match quality so an exact "Ahmed" outranks "Saad Ahmed".
  const scored = [];
  for (const c of contacts) {
    if (!c.isWAContact || c.isGroup || c.isMe) continue;
    if (!c.id || c.id.server !== 'c.us') continue;

    const display = c.name || c.pushname;
    if (!display) continue;

    const nm = display.toLowerCase();
    let score;
    if (nm === needle)              score = 0; // exact
    else if (nm.startsWith(needle)) score = 1; // prefix
    else if (wordRe.test(nm))       score = 2; // word boundary ("Saad Ahmed")
    else if (nm.includes(needle))   score = 3; // substring
    else continue;

    scored.push({ c, display, score });
  }

  // Best score first; alphabetical within a score for stable ordering.
  scored.sort((a, b) =>
    a.score - b.score || a.display.localeCompare(b.display)
  );

  const top = scored.slice(0, 6);

  // Fetch profile pics in parallel to stay within the frontend's resolve
  // timeout even with several candidates.
  const matches = await Promise.all(top.map(async ({ c, display }) => {
    let profilePicUrl = null;
    try { profilePicUrl = await client.getProfilePicUrl(c.id._serialized); }
    catch { /* no pic */ }
    return {
      chatId:  c.id._serialized,
      name:    display,
      number:  c.number ? `+${c.number}` : '',
      profilePicUrl,
    };
  }));

  return { query: to, matches };
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
