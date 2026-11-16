// Récupère la page d'accueil des N sites les plus visités NON bloqués et cherche la balise « adulte »
// exactement comme content/page-guard.js (meta rating = adult ou RTA).
import { readFileSync } from "node:fs";
// undici (fetch de Node) plante parfois sur une connexion coupée : on ignore, le site compte comme non lu.
process.on("uncaughtException", () => {});
const ROOT = process.argv[2];
const N = Number(process.argv[3] ?? 1000);
const blocked = new Set(readFileSync(`${ROOT}/data/blocklist.txt`, "utf8").trim().split("\n"));
const isBlocked = (d) => { const l = d.split("."); for (let i = 0; i < l.length - 1; i++) if (blocked.has(l.slice(i).join("."))) return true; return false; };
const tranco = readFileSync(`${ROOT}/tools/cache/tranco/top-1m.csv`, "utf8").trim().split("\n").map((l) => l.split(",")[1].trim());
const targets = process.argv[4] ? readFileSync(process.argv[4], "utf8").split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter((l) => l && !l.startsWith("[")) : tranco.filter((d) => !isBlocked(d)).slice(0, N);

const RTA = "rta-5042-1996-1400-1577-rta";
const metaRe = /<meta\b[^>]*>/gi;
function adultTag(html) {
  for (const m of html.match(metaRe) ?? []) {
    if (!/(name|http-equiv)\s*=\s*["']?rating["'\s>]/i.test(m)) continue;
    const c = (m.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] ?? "").trim().toLowerCase();
    if (c === "adult" || c.includes(RTA)) return c;
  }
  return null;
}

let done = 0, fetched = 0;
const hits = [];
async function check(d) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(`https://${d}/`, { signal: ctl.signal, redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0 Safari/537.36" } });
    clearTimeout(t);
    if ((res.headers.get("content-type") || "").includes("html")) {
      const html = (await res.text()).slice(0, 300_000);
      fetched++;
      const tag = adultTag(html);
      if (tag) hits.push(`${d} → ${tag}`);
    }
  } catch {}
  done++;
}
const queue = [...targets];
await Promise.all(Array.from({ length: 30 }, async () => { while (queue.length) await check(queue.shift()); }));
console.log(`${done} sites testés, ${fetched} pages HTML lues, ${hits.length} avec balise adulte`);
for (const h of hits) console.log("  " + h);
