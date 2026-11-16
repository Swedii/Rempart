// Audit des faux positifs de la liste générée (data/blocklist.txt) :
//  1) aucun suffixe public (co.uk, github.io…) ne doit être bloqué en entier ;
//  2) les sites très visités (classement Tranco) bloqués SANS mot évocateur dans leur nom sont listés
//     pour relecture humaine : les vrais faux positifs vont dans tools/blocklist-allow.txt.
// Usage : node tools/audit-false-positives.mjs [rang max, défaut 25000]
// Sortie : tools/cache/audit-suspects.tsv (rang, domaine, entrée de la liste qui le bloque)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "tools", "cache");
const MAX_RANK = Number(process.argv[2] ?? 25000);

async function download(url, file) {
  const path = join(CACHE, file);
  if (existsSync(path)) return path;
  mkdirSync(CACHE, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

const blocked = new Set(readFileSync(join(ROOT, "data", "blocklist.txt"), "utf8").trim().split("\n"));

const psl = readFileSync(await download("https://publicsuffix.org/list/public_suffix_list.dat", "psl.dat"), "utf8")
  .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//")).map((l) => l.replace(/^\*\.|^!/, ""));
const pslHits = psl.filter((s) => blocked.has(s));
console.log(`Suffixes publics bloqués en entier : ${pslHits.length}${pslHits.length ? " → " + pslHits.join(" ") : ""}`);

const csv = join(CACHE, "tranco", "top-1m.csv");
if (!existsSync(csv)) {
  const zip = await download("https://tranco-list.eu/top-1m.csv.zip", "tranco.zip");
  mkdirSync(join(CACHE, "tranco"), { recursive: true });
  execFileSync("tar", ["-xf", zip, "-C", join(CACHE, "tranco")]);
}
const tranco = readFileSync(csv, "utf8").trim().split("\n").map((l) => l.split(",")[1].trim().replace(/^www\./, ""));

// Noms qui annoncent clairement la couleur : pas besoin de relecture.
const EVOCATIVE = /porn|sex|xxx|xvideo|xnxx|xh|fuck|nude|naked|nsfw|hentai|milf|cam|escort|adult|erotic|ero|fetish|tube|jav|boob|tits|pussy|dick|cock|gay|lesb|shemale|onlyfans|fans|fap|babe|teen|slut|bdsm|horny|kink|strip|rule34|booru|bokep|desi|maal|hub|18|69/i;

const suspects = [];
let hits = 0;
for (let i = 0; i < Math.min(MAX_RANK, tranco.length); i++) {
  const labels = tranco[i].split(".");
  for (let k = 0; k < labels.length - 1; k++) {
    const p = labels.slice(k).join(".");
    if (blocked.has(p)) {
      hits++;
      if (!EVOCATIVE.test(tranco[i])) suspects.push(`${i + 1}\t${tranco[i]}\t${p}`);
      break;
    }
  }
}
writeFileSync(join(CACHE, "audit-suspects.tsv"), suspects.join("\n") + "\n");
console.log(`Top ${MAX_RANK} : ${hits} sites bloqués, dont ${suspects.length} à relire → tools/cache/audit-suspects.tsv`);
process.exit(pslHits.length ? 1 : 0);
