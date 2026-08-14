// Generate app icons (icon.ico + icon.png) with pure Node: rounded red tile + white music note
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- tiny PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // raw scanlines with filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- drawing ----------
function renderIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const r = size * 0.22; // corner radius
  const bg = [229, 72, 77]; // #e5484d
  const white = [255, 255, 255];
  const aa = 1.5; // supersample factor
  const SS = 3;

  // music note geometry (in unit space 0..1, y down)
  const stem = { x1: 0.38, y1: 0.22, x2: 0.66, y2: 0.74 }; // diagonal stem
  const stemW = 0.075;
  const c1 = { x: 0.33, y: 0.78, r: 0.1 }; // bottom-left note head
  const c2 = { x: 0.7, y: 0.62, r: 0.1 }; // top-right note head

  function distToSeg(pxx, pyy, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((pxx - x1) * dx + (pyy - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = x1 + t * dx, qy = y1 + t * dy;
    return Math.hypot(pxx - qx, pyy - qy);
  }

  function inRoundedRect(x, y, s) {
    const rr = r;
    const cx = Math.max(rr, Math.min(s - rr, x));
    const cy = Math.max(rr, Math.min(s - rr, y));
    return Math.hypot(x - cx, y - cy) <= rr;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = (x + (sx + 0.5) / SS) / size;
          const fy = (y + (sy + 0.5) / SS) / size;
          if (!inRoundedRect(fx * size, fy * size, size)) continue;
          const dStem = distToSeg(fx, fy, stem.x1, stem.y1, stem.x2, stem.y2);
          const d1 = Math.hypot(fx - c1.x, fy - c1.y);
          const d2 = Math.hypot(fx - c2.x, fy - c2.y);
          const d = Math.min(dStem - stemW / 2, d1 - c1.r, d2 - c2.r);
          if (d <= 0) hits++;
        }
      }
      const i = (y * size + x) * 4;
      const cov = hits / (SS * SS);
      if (cov > 0) {
        px[i] = Math.round(bg[0] + (white[0] - bg[0]) * cov);
        px[i + 1] = Math.round(bg[1] + (white[1] - bg[1]) * cov);
        px[i + 2] = Math.round(bg[2] + (white[2] - bg[2]) * cov);
        px[i + 3] = 255;
      } else if (inRoundedRect(x + 0.5, y + 0.5, size)) {
        px[i] = bg[0]; px[i + 1] = bg[1]; px[i + 2] = bg[2]; px[i + 3] = 255;
      }
    }
  }
  return px;
}

// ---------- ICO (PNG-compressed entry, Vista+) ----------
function encodeICO(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 0; // 256 -> 0
  entry[1] = 0;
  entry[2] = 0; // colors
  entry[3] = 0;
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(6 + 16, 12); // data offset
  return Buffer.concat([header, entry, png]);
}

const assets = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assets, { recursive: true });

const png256 = encodePNG(256, 256, renderIcon(256));
fs.writeFileSync(path.join(assets, 'icon.ico'), encodeICO(png256));
fs.writeFileSync(path.join(assets, 'icon.png'), encodePNG(512, 512, renderIcon(512)));
fs.writeFileSync(path.join(assets, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect x="16" y="16" width="224" height="224" rx="56" fill="#e5484d"/><path d="M97 200 V56 L176 40 V152" stroke="#fff" stroke-width="19" stroke-linecap="round" fill="none"/><circle cx="84" cy="200" r="26" fill="#fff"/><circle cx="163" cy="168" r="26" fill="#fff"/></svg>`);
console.log('icons written to', assets);
