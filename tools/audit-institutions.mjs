// Liste les domaines institutionnels (gouvernement, enseignement, armée…) encore bloqués : avec la règle
// « dans le doute on laisse passer », seuls ceux dont l'adresse contient un mot explicite doivent rester.
// Usage : node tools/audit-institutions.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { INSTITUTIONAL_RE, isProtectedInstitution } from "./build-blocklist.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const blocked = readFileSync(join(ROOT, "data", "blocklist.txt"), "utf8").trim().split("\n");
const inst = blocked.filter((d) => INSTITUTIONAL_RE.test(d));
const wrong = inst.filter(isProtectedInstitution);
console.log(`${inst.length} adresse(s) institutionnelle(s) bloquée(s), toutes avec un mot explicite :`);
for (const d of inst) console.log("  " + d);
if (wrong.length) { console.log(`ERREUR : ${wrong.length} sans mot explicite`); process.exit(1); }
