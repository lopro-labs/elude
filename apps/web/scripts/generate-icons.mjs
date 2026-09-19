/**
 * Generates the PWA icon PNGs from the Elude mark (same geometry as
 * public/favicon.svg / Icons.tsx Logo) with zero dependencies: shapes are
 * rasterized with signed-distance coverage and encoded as PNG via node:zlib.
 *
 *   node apps/web/scripts/generate-icons.mjs
 *
 * Outputs into apps/web/public/icons/.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// ---------------------------------------------------------------------------
// Mark geometry in the 40x40 viewBox of favicon.svg
// ---------------------------------------------------------------------------
const BG = [0x0f, 0x15, 0x1d, 255];
const RED = [0xff, 0x5a, 0x5f, 255];
const RED_FAINT = [0xff, 0x5a, 0x5f, Math.round(0.35 * 255)];
const BLUE_A = [0x4f, 0x8c, 0xff];
const BLUE_B = [0x7f, 0xd3, 0xff];
const LIGHT = [0x7f, 0xd3, 0xff, 255];

// Route path: M8 33.5 c6.5,-1 9.5,-5.5 9.5,-11.5 c0,-6 3.5,-9 8,-9
// with transform: translate(-1.5,-3) rotate(-8, 20, 20)  (rotate applied first)
const CUBICS = [
  [
    [8, 33.5],
    [14.5, 32.5],
    [17.5, 28],
    [17.5, 22],
  ],
  [
    [17.5, 22],
    [17.5, 16],
    [21, 13],
    [25.5, 13],
  ],
];

function transformPoint([x, y]) {
  const a = (-8 * Math.PI) / 180;
  const cx = 20,
    cy = 20;
  const rx = cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a);
  const ry = cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a);
  return [rx - 1.5, ry - 3];
}

/** Flatten the route cubics into a dense polyline (in 40-unit space). */
function routePolyline() {
  const pts = [];
  for (const [p0, p1, p2, p3] of CUBICS) {
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const mt = 1 - t;
      const x = mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0];
      const y = mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1];
      pts.push(transformPoint([x, y]));
    }
  }
  return pts;
}
const ROUTE = routePolyline();

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax,
    dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + t * dx,
    qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function distToPolyline(px, py, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const d = distToSegment(px, py, pts[i - 1], pts[i]);
    if (d < best) best = d;
  }
  return best;
}

/** Colour of the mark at point (x,y) in 40-unit space, composited over bg. Returns [r,g,b,a 0..255] of the topmost hit or null. */
function sample(x, y) {
  // Painted back-to-front; return the first opaque-ish hit front-to-back instead.
  // Front-most: light-blue start dot
  if (Math.hypot(x - 7.2, y - 31) <= 2.6) return LIGHT;

  // Route stroke (round caps come free from polyline distance)
  const dRoute = distToPolyline(x, y, ROUTE);
  if (dRoute <= 3.4 / 2) {
    const t = Math.max(0, Math.min(1, (x / 40 + (40 - y) / 40) / 2));
    return [
      Math.round(BLUE_A[0] + (BLUE_B[0] - BLUE_A[0]) * t),
      Math.round(BLUE_A[1] + (BLUE_B[1] - BLUE_A[1]) * t),
      Math.round(BLUE_A[2] + (BLUE_B[2] - BLUE_A[2]) * t),
      255,
    ];
  }

  // Camera dot
  if (Math.hypot(x - 25.5, y - 15) <= 3.1) return RED;

  // Dashed gaze ring: stroke r=7.5 w=1.2, dash "2 2.6" along the arc
  const dc = Math.hypot(x - 25.5, y - 15);
  if (Math.abs(dc - 7.5) <= 0.6) {
    const ang = Math.atan2(y - 15, x - 25.5);
    const arc = ((ang + Math.PI) * 7.5) % (2 + 2.6);
    if (arc < 2) return RED_FAINT;
  }
  return null;
}

/** Render one icon. mode: 'rounded' (app-style rounded rect on transparent) | 'square' (full-bleed) | 'maskable' (full-bleed, mark scaled into safe zone). */
function render(size, mode) {
  const px = new Uint8Array(size * size * 4);
  const SS = 3; // supersampling
  const cornerR = (11 / 40) * size;
  const scale = mode === 'maskable' ? 0.72 : 1;

  for (let iy = 0; iy < size; iy++) {
    for (let ix = 0; ix < size; ix++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = ix + (sx + 0.5) / SS;
          const fy = iy + (sy + 0.5) / SS;

          // Background shape coverage
          let inBg = true;
          if (mode === 'rounded') {
            const rx = Math.max(0, Math.max(cornerR - fx, fx - (size - cornerR)));
            const ry = Math.max(0, Math.max(cornerR - fy, fy - (size - cornerR)));
            inBg = Math.hypot(rx, ry) <= cornerR;
          }
          if (!inBg) continue;

          // Map to 40-unit mark space (optionally shrunk for maskable safe zone)
          const u = ((fx / size - 0.5) / scale + 0.5) * 40;
          const v = ((fy / size - 0.5) / scale + 0.5) * 40;
          let c = u >= 0 && u <= 40 && v >= 0 && v <= 40 ? sample(u, v) : null;
          if (!c) c = BG;
          else if (c[3] < 255) {
            // composite translucent mark colour over bg
            const al = c[3] / 255;
            c = [
              Math.round(c[0] * al + BG[0] * (1 - al)),
              Math.round(c[1] * al + BG[1] * (1 - al)),
              Math.round(c[2] * al + BG[2] * (1 - al)),
              255,
            ];
          }
          r += c[0];
          g += c[1];
          b += c[2];
          a += 255;
        }
      }
      const n = SS * SS;
      const o = (iy * size + ix) * 4;
      // premultiplied-ish average: scale colour by coverage
      const cov = a / (n * 255);
      px[o] = Math.round(r / n / (cov || 1));
      px[o + 1] = Math.round(g / n / (cov || 1));
      px[o + 2] = Math.round(b / n / (cov || 1));
      px[o + 3] = Math.round(255 * cov);
    }
  }
  return px;
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder (RGBA8, filter 0)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
const jobs = [
  ['icon-192.png', 192, 'rounded'],
  ['icon-512.png', 512, 'rounded'],
  ['icon-maskable-512.png', 512, 'maskable'],
  ['apple-touch-icon.png', 180, 'square'],
];
for (const [name, size, mode] of jobs) {
  const png = encodePng(size, render(size, mode));
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}
