// Reformate extension/rules/safety.json : une règle par ligne (lisible, diffs courts).
import { readFileSync, writeFileSync } from "node:fs";
const p = new URL("../extension/rules/safety.json", import.meta.url);
const rules = JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
writeFileSync(p, "[\n" + rules.map((r) => "  " + JSON.stringify(r)).join(",\n") + "\n]\n");
console.log(`${rules.length} règles`);
