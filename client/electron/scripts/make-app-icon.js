// Generates electron/build/icon.png — the 256x256 application icon that
// electron-builder bakes into the packaged .exe and the NSIS installer.
//
// Why this exists:
//   electron-builder needs an icon that is at least 256x256 to derive a
//   Windows .ico. The tray-icon.png is only 32x32 (fine for the system
//   tray, too small here). Rather than commit a binary that can drift,
//   we draw the icon procedurally with zlib — no image libraries, no
//   network — so a fresh `npm install` always yields a valid build icon.
//
//   Wired to "postinstall" alongside make-placeholder-icon.js.
//
// To replace it with real artwork:
//   Drop your own >=256x256 PNG at electron/build/icon.png and skip this.
//
// The art is a soft violet radial disc with a lighter core on a
// transparent field — on-brand (Violet) and recognizable at small sizes.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

// Brand colours. Outer ring -> inner core, blended by radius.
const EDGE = { r: 0x7c, g: 0x3a, b: 0xed }; // deep violet (#7c3aed)
const CORE = { r: 0xe8, g: 0x79, b: 0xf9 }; // light magenta (#e879f9)

const cx = (SIZE - 1) / 2;
const cy = (SIZE - 1) / 2;
const R = SIZE / 2 - 6;        // disc radius, small inset margin
const EDGE_AA = 1.5;           // anti-alias band width in px

// Raw RGBA, one byte per channel, plus a leading filter byte per row.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));

let p = 0;
for (let y = 0; y < SIZE; y++) {
  raw[p++] = 0; // filter type 0 (none) for this scanline
  for (let x = 0; x < SIZE; x++) {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Coverage: 1 inside the disc, ramped to 0 across the AA band.
    let cover = 1;
    if (dist > R) cover = 0;
    else if (dist > R - EDGE_AA) cover = (R - dist) / EDGE_AA;

    // Colour blend from core (centre) to edge (rim).
    const t = Math.min(dist / R, 1);
    const r = Math.round(CORE.r + (EDGE.r - CORE.r) * t);
    const g = Math.round(CORE.g + (EDGE.g - CORE.g) * t);
    const b = Math.round(CORE.b + (EDGE.b - CORE.b) * t);

    raw[p++] = r;
    raw[p++] = g;
    raw[p++] = b;
    raw[p++] = Math.round(cover * 255);
  }
}

// ── minimal PNG container ────────────────────────────────────────────
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
  }
  return ~c;
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // colour type 6 = RGBA
ihdr[10] = 0;  // compression
ihdr[11] = 0;  // filter
ihdr[12] = 0;  // interlace

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const outPath = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, png);

console.log(
  '[persona] wrote app icon (' + png.length + ' bytes, ' +
  SIZE + 'x' + SIZE + ') to ' + outPath
);
