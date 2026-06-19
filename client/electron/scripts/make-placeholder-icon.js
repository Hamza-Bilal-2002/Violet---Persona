// Generates electron/assets/tray-icon.png at install time.
//
// Why this exists:
//   The Electron Tray API needs a real PNG file on disk at startup. We
//   don't want to commit a binary that can drift out of sync with the
//   shell, and we don't want the user to fetch one manually. This script
//   decodes a baked-in base64 PNG (a 32x32 magenta circle on transparent
//   background) and writes it to assets/tray-icon.png.
//
//   It's wired to "postinstall" in package.json so a fresh `npm install`
//   inside electron/ produces a working tray icon with no extra steps.
//
// To replace the icon with a real one:
//   1. Drop your own PNG at electron/assets/tray-icon.png, OR
//   2. Re-encode a different PNG below and re-run `node scripts/make-placeholder-icon.js`.
//
// The placeholder is deliberately magenta (#e879f9) so it's visually
// obvious in the system tray that it has not yet been customized.

const fs
  = require('fs');

const path
  = require('path');

// 32x32 RGBA, magenta circle on transparent background, 239 bytes.
// Generated once with a small Python script and embedded here so this
// file is fully self-contained.

const PNG_BASE64
  = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAtklEQVR42u2XwQ2A'
    + 'IAxFXYCt2IEd2MADOzANO7CJK3jCktQLB0CEtjE2eRej+R9pS9m2Px7GsZ8K0IAF'
    + 'HGLxmVopbIAApAb5HTNTOK8sdgiX5G/0W3E3IFziRsX9BPEbz7HysT+Be54WoXsM'
    + 'xIUGYk+ppcWYmoFAYCDUOlwiQlEnXzsZsZ9TGbBUtd/fEyQYYN8C9iTkLUP2RiSi'
    + 'FbMfRiKOY/aBRMRIJmIoFTGWi7iYiLmafTYusFzjlj0oKMwAAAAASUVORK5CYII=';

const buf
  = Buffer.from(PNG_BASE64, 'base64');

const outPath
  = path.join(
      __dirname,
      '..',
      'assets',
      'tray-icon.png'
    );

fs.mkdirSync(
  path.dirname(outPath),
  { recursive: true }
);

fs.writeFileSync(outPath, buf);

console.log(
  '[persona] wrote placeholder tray icon (' + buf.length + ' bytes) to ' + outPath
);
