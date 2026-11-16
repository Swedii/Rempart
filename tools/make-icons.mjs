// Dessine l'icône de Rempart (bouclier) en PNG, sans dépendance : rendu par fonction de distance + anticrénelage.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "extension", "icons");

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Bouclier en coordonnées normalisées [0,1] : haut droit arrondi, côtés qui se rejoignent en pointe.
function insideShield(x, y, inset = 0) {
  const top = 0.12 + inset, bottom = 0.92 - inset * 1.4, half = 0.38 - inset;
  if (y < top || y > bottom) return false;
  const t = (y - top) / (bottom - top);
  const w = t < 0.45 ? half : half * Math.cos(((t - 0.45) / 0.55) * Math.PI / 2) ** 0.8;
  return Math.abs(x - 0.5) <= w;
}
// Créneau de rempart (encoches en haut).
function inNotch(x, y) {
  if (y > 0.24) return false;
  const k = Math.floor((x - 0.12) / (0.76 / 5));
  return k === 1 || k === 3;
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let outer = 0, inner = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
      if (insideShield(x, y) && !inNotch(x, y)) {
        outer++;
        if (insideShield(x, y, 0.09) && y > 0.3) inner++;
      }
    }
    const a = outer / (SS * SS), ai = inner / (SS * SS);
    // vert profond + cœur plus clair
    const r = 47 + (108 - 47) * ai, g = 107 + (195 - 107) * ai, b = 90 + (166 - 90) * ai;
    const i = (py * size + px) * 4;
    buf[i] = Math.round(r); buf[i + 1] = Math.round(g); buf[i + 2] = Math.round(b); buf[i + 3] = Math.round(a * 255);
  }
  return png(size, buf);
}

mkdirSync(OUT, { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(join(OUT, `${s}.png`), render(s));
console.log("Icônes écrites dans", OUT);
