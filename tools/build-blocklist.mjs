// Construit la liste de domaines bloqués à partir de listes publiques.
// Sorties :
//   extension/rules/blocklist-1.json … blocklist-6.json — règles declarativeNetRequest (ensembles statiques,
//     un paquet de 100 000 domaines par fichier : Firefox Add-ons refuse d'analyser un fichier de plus de 5 Mo)
//   extension/rules/meta.json       — nombre de domaines, date, sources
//   data/blocklist.txt              — un domaine par ligne (pour le futur service Windows et l'appli Android)
// Usage : node tools/build-blocklist.mjs [--offline]   (--offline = réutilise tools/cache sans télécharger)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "tools", "cache");
const OFFLINE = process.argv.includes("--offline");

// Source unique : OISD NSFW (« Block. Don't break. »), choisie pour son très faible taux de faux positifs.
// Audit du 16/11/2026 contre le top 1M Tranco : les listes Block List Project et StevenBlack bloquaient
// b-cdn.net (CDN), ekstrabladet.dk, cosmopolitan.com, kinopoisk.ru, yandex.by, match.com… ; OISD aucun.
export const SOURCES = [
  {
    name: "oisd nsfw",
    url: "https://nsfw.oisd.nl/domainswild2",
    file: "oisd-nsfw.txt",
    license: "GPL-3.0",
  },
];

// Liste des suffixes publics (co.uk, github.io, blogspot.com…) : bloquer l'un d'eux en entier
// bloquerait des milliers de sites sans rapport. Tout suffixe public est retiré de la liste.
const PSL = { url: "https://publicsuffix.org/list/public_suffix_list.dat", file: "psl.dat" };

// Nombre de domaines par règle : une règle requestDomains peut en contenir beaucoup,
// on découpe pour garder des règles de taille raisonnable.
const CHUNK = 100_000;
const BLOCKED_PAGE = "/pages/blocked.html";
const ALL_TYPES = ["main_frame", "sub_frame", "image", "media", "script", "xmlhttprequest",
  "stylesheet", "font", "object", "websocket", "ping", "other"];

const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/** Extrait un domaine d'une ligne au format « domaine » ou « hosts » ; null si la ligne n'en contient pas. */
export function parseLine(line) {
  let s = line.replace(/#.*$/, "").trim().toLowerCase();
  if (!s) return null;
  const parts = s.split(/\s+/);
  if (parts.length >= 2 && /^(0\.0\.0\.0|127\.0\.0\.1|::1?)$/.test(parts[0])) s = parts[1];
  else if (parts.length !== 1) return null;
  s = s.replace(/^\*\./, "").replace(/\.$/, "");
  if (s.startsWith("www.")) s = s.slice(4);
  if (s === "localhost" || s.endsWith(".local") || !DOMAIN_RE.test(s)) return null;
  return s;
}

/**
 * Fusionne, retire les domaines autorisés (exactement : leurs sous-domaines restent bloqués),
 * puis retire les sous-domaines déjà couverts par un parent bloqué (requestDomains couvre les sous-domaines).
 */
// Domaines institutionnels (gouvernement, enseignement, armée, justice, santé publique…).
// Ils apparaissent dans les listes surtout après un piratage (spam hébergé un temps) : c'est un doute,
// et dans le doute on laisse passer. Exception : une adresse qui contient elle-même un mot explicite
// (ex. « erapornew2026.smkn6bkl.sch.id », page de spam sur un site d'école piraté) reste bloquée.
export const INSTITUTIONAL_RE =
  /\.(gov|edu|mil|int)$|\.(gov|gouv|gob|govt|go|gv|edu|ac|mil|sch|k12|nic|police|nhs)\.[a-z]{2,3}$|\.gouv\.fr$/;
// « sex » seulement comme mot à part (pas « nagiosext », « essex », « sussex »…).
export const EXPLICIT_RE = /porn|xxx|hentai|nude|naked|fuck|bokep|xvideo|nsfw|bdsm|erotic|(?<![a-z])sex|sex(?![a-z])/;
export const isProtectedInstitution = (d) => INSTITUTIONAL_RE.test(d) && !EXPLICIT_RE.test(d);

export function buildDomainSet(domains, allow) {
  const set = new Set(domains);
  for (const a of allow) set.delete(a);
  for (const d of set) if (isProtectedInstitution(d)) set.delete(d);
  // Tous les parents des domaines autorisés (ex. « github.io » → « io » ; « x.y.com » → « y.com », « com »).
  const allowParents = new Set();
  for (const a of allow) {
    const l = a.split(".");
    for (let i = 1; i < l.length; i++) allowParents.add(l.slice(i).join("."));
  }
  const out = [];
  for (const d of set) {
    const labels = d.split(".");
    let covered = false;
    for (let i = 1; i < labels.length - 1; i++) {
      const parent = labels.slice(i).join(".");
      if (set.has(parent)) { covered = true; break; }
    }
    // Ne jamais bloquer un parent d'un domaine autorisé (ex. « co.uk » ou « com » mal listés).
    if (!covered && !allowParents.has(d)) out.push(d);
  }
  return out.sort();
}

// Nombre fixe de fichiers de règles, déclarés un par un dans manifest.json (les fichiers en trop restent vides).
export const RULE_FILES = 6;

/** Une règle (un paquet de domaines) par fichier : extension/rules/blocklist-<n>.json. */
export async function writeRuleFiles(rules) {
  if (rules.length > RULE_FILES) throw new Error(`${rules.length} paquets de domaines : augmenter RULE_FILES et manifest.json`);
  for (let n = 1; n <= RULE_FILES; n++) {
    await writeFile(join(ROOT, "extension", "rules", `blocklist-${n}.json`), JSON.stringify(rules[n - 1] ? [rules[n - 1]] : []));
  }
}

export function makeRules(domains) {
  const rules = [];
  let id = 1;
  for (let i = 0; i < domains.length; i += CHUNK) {
    const chunk = domains.slice(i, i + CHUNK);
    // Une seule règle par paquet (sinon chaque domaine est écrit deux fois) : la page principale est
    // redirigée vers la page de blocage ; les ressources intégrées (images, vidéos…) sont redirigées
    // aussi, ce qui revient à les bloquer (une image ne peut pas s'afficher à partir d'une page HTML).
    rules.push({
      id: id++, priority: 1,
      action: { type: "redirect", redirect: { extensionPath: BLOCKED_PAGE } },
      // resourceTypes explicite : sans lui, Chrome exclut main_frame.
      condition: { requestDomains: chunk, resourceTypes: ALL_TYPES },
    });
  }
  return rules;
}

async function readList(file) {
  return (await readFile(file, "utf8")).split(/\r?\n/).map(parseLine).filter(Boolean);
}

async function fetchSource(src) {
  const path = join(CACHE, src.file);
  if (OFFLINE) {
    if (!existsSync(path)) throw new Error(`--offline : ${path} absent`);
    return path;
  }
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`${src.name} : HTTP ${res.status}`);
  await mkdir(CACHE, { recursive: true });
  await writeFile(path, await res.text());
  return path;
}

async function readPublicSuffixes() {
  const text = await readFile(await fetchSource({ name: "Public Suffix List", ...PSL }), "utf8");
  return text.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .map((l) => l.replace(/^\*\.|^!/, "").toLowerCase());
}

async function main() {
  const allow = await readList(join(ROOT, "tools", "blocklist-allow.txt"));
  for (const s of await readPublicSuffixes()) allow.push(s);
  const all = await readList(join(ROOT, "tools", "blocklist-extra.txt"));
  for (const src of SOURCES) {
    const list = await readList(await fetchSource(src));
    console.log(`${src.name} : ${list.length} domaines`);
    for (const d of list) all.push(d);
  }
  const domains = buildDomainSet(all, allow);
  console.log(`Après fusion et dédoublonnage : ${domains.length} domaines`);

  await mkdir(join(ROOT, "extension", "rules"), { recursive: true });
  await mkdir(join(ROOT, "data"), { recursive: true });
  await writeRuleFiles(makeRules(domains));
  await writeFile(join(ROOT, "extension", "rules", "meta.json"), JSON.stringify({
    count: domains.length,
    builtAt: new Date().toISOString(),
    sources: SOURCES.map(({ name, url, license }) => ({ name, url, license })),
  }, null, 2));
  await writeFile(join(ROOT, "data", "blocklist.txt"), domains.join("\n") + "\n");
  console.log(`Écrit : extension/rules/blocklist-1…${RULE_FILES}.json, extension/rules/meta.json, data/blocklist.txt`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
