// WhatsApp QR code popup window.
//
// Creates a small always-on-top window showing a scannable QR image.
// Call showQr(qrString) when a new QR code arrives from whatsapp-web.js.
// Call hideQr() when WhatsApp connects (or the user cancels).

const { BrowserWindow } = require('electron');

let _win = null;

async function showQr(qrString) {
  let QRCode;
  try {
    QRCode = require('qrcode');
  } catch {
    console.warn('[qrWindow] qrcode package not installed — run: cd electron && npm install');
    return;
  }

  let dataUrl;
  try {
    dataUrl = await QRCode.toDataURL(qrString, {
      width:  280,
      margin: 2,
      color:  { dark: '#000000', light: '#ffffff' },
    });
  } catch (err) {
    console.error('[qrWindow] Failed to generate QR image:', err.message);
    return;
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 320px;
    height: 400px;
    background: #141414;
    font-family: -apple-system, 'Segoe UI', sans-serif;
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    user-select: none;
    -webkit-app-region: drag;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .wa-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #25D366;
    box-shadow: 0 0 6px #25D366;
  }
  h2 {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: rgba(255,255,255,0.9);
  }
  .qr-frame {
    padding: 12px;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.5);
  }
  img {
    display: block;
    width: 256px;
    height: 256px;
  }
  p {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
    text-align: center;
    line-height: 1.5;
    max-width: 240px;
  }
  .hint {
    font-size: 10px;
    color: rgba(255,255,255,0.25);
  }
</style>
</head>
<body>
  <div class="header">
    <div class="wa-dot"></div>
    <h2>Link WhatsApp</h2>
  </div>
  <div class="qr-frame">
    <img src="${dataUrl}" alt="WhatsApp QR code">
  </div>
  <p>Open WhatsApp on your phone<br>Tap <strong>Linked Devices → Link a Device</strong></p>
  <span class="hint">Click and drag to move • Window closes when connected</span>
</body>
</html>`;

  if (_win && !_win.isDestroyed()) {
    _win.webContents.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(html)
    );
    if (!_win.isVisible()) _win.show();
    return;
  }

  _win = new BrowserWindow({
    width:       320,
    height:      400,
    frame:       false,
    alwaysOnTop: true,
    resizable:   false,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: '#141414',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  _win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  _win.show();

  _win.on('closed', () => {
    _win = null;
  });
}

function hideQr() {
  if (_win && !_win.isDestroyed()) {
    _win.close();
  }
  _win = null;
}

module.exports = { showQr, hideQr };
