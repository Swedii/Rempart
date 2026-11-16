// Vérifie qu'aucun site de tests/never-block.txt n'est bloqué par la liste générée (data/blocklist.txt),
// en appliquant la même logique que Chrome : un domaine listé bloque aussi tous ses sous-domaines.
// Usage : node tests/false-positives.test.mjs   (après npm run build:blocklist)

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const blocked = new Set(readFileSync(join(ROOT, "data", "blocklist.txt"), "utf8").trim().split("\n"));

/** Entrée de la liste qui bloque `domain` (lui-même ou un parent), sinon null. */
function blockedBy(domain) {
  const l = domain.split(".");
  for (let i = 0; i < l.length - 1; i++) {
    const p = l.slice(i).join(".");
    if (blocked.has(p)) return p;
  }
  return null;
}

let section = "";
let total = 0;
const failures = [];
for (const raw of readFileSync(join(ROOT, "tests", "never-block.txt"), "utf8").split(/\r?\n/)) {
  const line = raw.replace(/#.*$/, "").trim();
  if (!line) continue;
  if (line.startsWith("[")) { section = line.slice(1, -1); continue; }
  total++;
  const by = blockedBy(line.toLowerCase());
  if (by) failures.push(`${section} : ${line}${by !== line ? ` (via ${by})` : ""}`);
}

// Aucun domaine institutionnel ne doit être bloqué en entier, sauf adresse explicitement pornographique.
const { isProtectedInstitution } = await import("../tools/build-blocklist.mjs");
const institutions = [...blocked].filter(isProtectedInstitution);
total += 1;
if (institutions.length) failures.push(`Institutions bloquées : ${institutions.slice(0, 20).join(", ")}`);

if (failures.length) {
  console.log(`FAIL ${failures.length} site(s) légitime(s) bloqué(s) sur ${total} :`);
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log(`OK   ${total} sites sensibles mais légitimes, aucun bloqué`);
