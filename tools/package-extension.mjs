// Fabrique le paquet de l'extension : Chrome Web Store (sortie/rempart-chrome-<version>.zip) ou, avec --firefox,
// Firefox Add-ons (sortie/rempart-firefox-<version>.zip).
// Usage : npm run package:chrome · npm run package:firefox   (lancer d'abord « npm run build:blocklist »)
// Paquet Firefox : background.service_worker retiré (Firefox utilise background.scripts, une page d'événements).
// Le manifeste du paquet Chrome est nettoyé des clés propres à Firefox (background.scripts,
// browser_specific_settings), qui ne servent à rien dans Chrome et provoquent des avertissements.
// Zip écrit à la main (aucune dépendance) : chemins avec « / », compression deflate.

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, crc32 } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(ROOT, "extension");
const OUT = join(ROOT, "sortie");

// Fichiers jamais inclus : générés par Chrome au chargement, fichiers système.
const IGNORE = new Set(["_metadata", ".DS_Store", "Thumbs.db"]);

for (const needed of ["rules/blocklist-1.json", "rules/meta.json"]) {
  if (!existsSync(join(EXT, needed))) {
    console.error(`Manque extension/${needed} : lancer d'abord « npm run build:blocklist ».`);
    process.exit(1);
  }
}

function listFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    if (IGNORE.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...listFiles(full));
    else files.push(full);
  }
  return files;
}

// Limites du Chrome Web Store : nom ≤ 75 caractères, description ≤ 132 (sinon le paquet est refusé).
for (const lang of readdirSync(join(EXT, "_locales"))) {
  const m = JSON.parse(readFileSync(join(EXT, "_locales", lang, "messages.json"), "utf8"));
  for (const [key, max] of [["extName", 75], ["extDescription", 132]]) {
    const n = [...m[key].message].length;
    if (n > max) { console.error(`_locales/${lang} : ${key} fait ${n} caractères (maximum ${max}).`); process.exit(1); }
  }
}

const FIREFOX = process.argv.includes("--firefox");
const manifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
if (FIREFOX) {
  delete manifest.background.service_worker;
} else {
  delete manifest.browser_specific_settings;
  delete manifest.background.scripts;
}

const entries = listFiles(EXT).map((full) => {
  const name = relative(EXT, full).split(sep).join("/");
  const data = name === "manifest.json" ? Buffer.from(JSON.stringify(manifest, null, 2) + "\n") : readFileSync(full);
  return { name, data };
});

// ---------- écriture du zip ----------
const DOS_TIME = 0;            // 00:00:00
const DOS_DATE = (1 << 5) | 1; // 1980-01-01 : dates fixes, le paquet ne dépend que du contenu
const local = [];
const central = [];
let offset = 0;
for (const { name, data } of entries) {
  const nameBuf = Buffer.from(name, "utf8");
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);       // version requise
  head.writeUInt16LE(0x0800, 6);   // noms en UTF-8
  head.writeUInt16LE(8, 8);        // deflate
  head.writeUInt16LE(DOS_TIME, 10);
  head.writeUInt16LE(DOS_DATE, 12);
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(packed.length, 18);
  head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(nameBuf.length, 26);
  head.writeUInt16LE(0, 28);
  local.push(head, nameBuf, packed);

  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0);
  dir.writeUInt16LE(20, 4);
  dir.writeUInt16LE(20, 6);
  dir.writeUInt16LE(0x0800, 8);
  dir.writeUInt16LE(8, 10);
  dir.writeUInt16LE(DOS_TIME, 12);
  dir.writeUInt16LE(DOS_DATE, 14);
  dir.writeUInt32LE(crc, 16);
  dir.writeUInt32LE(packed.length, 20);
  dir.writeUInt32LE(data.length, 24);
  dir.writeUInt16LE(nameBuf.length, 28);
  dir.writeUInt32LE(offset, 42);
  central.push(dir, nameBuf);
  offset += head.length + nameBuf.length + packed.length;
}
const centralSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(OUT, { recursive: true });
const file = join(OUT, `rempart-${FIREFOX ? "firefox" : "chrome"}-${manifest.version}.zip`);
writeFileSync(file, Buffer.concat([...local, ...central, end]));
console.log(`${relative(ROOT, file)} : ${entries.length} fichiers, ${(statSync(file).size / 1e6).toFixed(1)} Mo`);
