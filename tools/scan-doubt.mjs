// Départage les domaines bloqués « sans indice » (nom neutre, absents des autres listes) mais assez visités
// (top 1M Tranco) en lisant le TITRE et la DESCRIPTION de leur page d'accueil.
//
// Précautions (règle du projet : ne jamais contacter de site illégal) :
//  - aucun domaine dont le nom évoque des mineurs, des dessins (hentai, manga…), des animaux, du viol, de l'inceste,
//    des fuites / contenus non consentis, du gore ou du piratage n'est contacté ;
//  - les noms illisibles (xn--…) et les noms « porno dans une autre langue » ne sont pas contactés (ils restent bloqués) ;
//  - seule la page d'accueil est demandée, lecture limitée à 64 Ko de HTML, rien d'autre n'est téléchargé
//    (ni image, ni script, ni vidéo) ; seuls titre et description sont conservés ;
//  - une redirection vers un AUTRE domaine n'est jamais suivie.
//
// Usage : node tools/scan-doubt.mjs [--dry-run]
// Sortie : tools/cache/scan-doubt.tsv (rang, domaine, verdict, titre, description)

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLine } from "./build-blocklist.mjs";

process.on("uncaughtException", () => {}); // bug connu d'undici sur connexions coupées

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "tools", "cache");
const DRY = process.argv.includes("--dry-run");

// Nom déjà évocateur : pas un « doute ».
const EVOC = /porn|sex|xxx|xvideo|xnxx|fuck|nude|naked|nsfw|hentai|milf|cam|escort|adult|erotic|ero|fetish|tube|jav|boob|tit|pussy|dick|cock|gay|lesb|shemale|tranny|onlyfans|fans|fap|babe|teen|slut|bdsm|horny|kink|strip|rule34|booru|bokep|desi|maal|hot|girl|nud|anal|ass|bitch|whore|slave|mistress|dom|chat|date|dating|flirt|hookup|affair|swing|lust|sexy|69|18|av|vid|clip|live|tgp|gallery|pics|pic|lingerie|panty|feet|foot|wife|mom|mature|granny|cuck|incest|taboo|cum|jizz|squirt|orgasm|kama|chudai|kahani|blue|masala|mms|xx|x-|-x|hub|tv|cdn/;

// JAMAIS contactés : risque de contenu illégal (mineurs, dessins, animaux, non-consentement, fuites, gore) ou piratage.
const RISK = new RegExp([
  "child", "kid", "teen", "young", "junior", "minor", "menor", "loli", "shota", "pedo", "preteen", "jailbait", "baby",
  "school", "student", "studentk", "colegial", "novinh", "ninfet", "bocil", "abg", "smp", "sma", "pelajar", "anak",
  "devochk", "malolet", "shkol", "pupil", "boy", "girl", "virgin", "little", "tiny", "petite", "kawaii", "idol",
  "hentai", "doujin", "manga", "manhwa", "manhua", "comic", "comix", "toon", "anime", "r34", "rule34", "ecchi", "acg",
  "zoo", "animal", "beast", "bestial", "dog", "horse", "pet",
  "rape", "raped", "forced", "force", "abuse", "incest", "taboo", "drunk", "sleep", "uncen", "uncut", "nonconsent",
  "leak", "fake", "deepfake", "undress", "nudify", "clothoff", "voyeur", "spy", "hidden", "upskirt", "creep", "mms",
  "viral", "scandal", "exposed", "revenge", "celeb", "famos", "privacy",
  "gore", "snuff", "death", "die", "kill", "murder",
  "movie", "film", "flix", "cine", "cima", "series", "serie", "izle", "phim", "torrent", "watch", "stream", "hd",
  "dizi", "drama", "duanju", "episode", "vod", "kino",
  // ajoutés après relecture du premier calcul
  "omegle", "pururin", "niji", "yuri", "waifu", "dongman", "mikuclub", "puni", "duiduiman", "nhanman", "mkzhan",
  "huashi", "dojin", "ani(bk|tr|hidee)", "ppv", "fc2", "privat", "sliv", "tape", "kanliao", "baoliao", "heiliao",
  "chigua", "nuki", "geinou", "chira", "eva-green", "liuyifei", "iwamiayano", "spies", "cherry", "qiz", "devushk",
  "bocah", "gadis", "skandal", "scat", "pee", "galleries", "rip", "tumblr", "omek", "yadong", "pizd", "golye",
].join("|"));

// Porno dans une autre langue ou sites miroirs connus : restent bloqués sans être contactés.
const PROBABLE = /phimheo|phimx|seks|porevo|trah|xh|pxp|iyot|kantot|kantut|colmek|lendir|chudai|vasna|maza|masti|chut|desi|pinay|sulasok|jogemoa|vlx|masa49|auntymaza|fsiblog|koselarab|arab|sosalkino|doeda|huangguo|7dakalr|ulluuncut|tdxflix|pahindot|wn0|wn1|3x1|yaburi|redbogo|xmasti|xamador|mastiraja|zebaw|lol49|lala49|poni208|miss148|missav|tellyhd|webxseries|mxseries|oolveri|bhojpuri/;

const blocked = readFileSync(join(ROOT, "data", "blocklist.txt"), "utf8").trim().split("\n");
const second = new Set();
for (const f of ["blp-porn.txt", "sb-porn.hosts"]) {
  for (const l of readFileSync(join(CACHE, f), "utf8").split(/\r?\n/)) { const d = parseLine(l); if (d) second.add(d); }
}
const covered = (set, d) => { const l = d.split("."); for (let i = 0; i < l.length - 1; i++) if (set.has(l.slice(i).join("."))) return true; return false; };
const rank = new Map();
readFileSync(join(CACHE, "tranco", "top-1m.csv"), "utf8").trim().split("\n").forEach((l, i) => {
  const d = l.split(",")[1].trim().replace(/^www\./, "");
  if (!rank.has(d)) rank.set(d, i + 1);
});

const doubt = blocked.filter((d) => rank.has(d) && !EVOC.test(d) && !covered(second, d));
const excludedRisk = doubt.filter((d) => RISK.test(d) || d.startsWith("xn--") || d.includes(".xn--"));
const excludedProbable = doubt.filter((d) => !excludedRisk.includes(d) && PROBABLE.test(d));
const targets = doubt.filter((d) => !excludedRisk.includes(d) && !excludedProbable.includes(d))
  .sort((a, b) => rank.get(a) - rank.get(b));

console.log(`Sans indice et populaires : ${doubt.length}`);
console.log(`  exclus (risque d'illégalité ou nom illisible, jamais contactés) : ${excludedRisk.length}`);
console.log(`  exclus (porno probable dans une autre langue, restent bloqués) : ${excludedProbable.length}`);
console.log(`  à contacter (page d'accueil, texte seulement) : ${targets.length}`);
if (DRY) { console.log(targets.join(" ")); process.exit(0); }

// ---------- lecture prudente ----------
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0 Safari/537.36";
const sameSite = (host, domain) => { const h = host.replace(/^www\./, ""); return h === domain || h.endsWith("." + domain); };

async function readHead(domain) {
  let url = `https://${domain}/`;
  for (let hop = 0; hop < 4; hop++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, { redirect: "manual", signal: ctl.signal,
        headers: { "user-agent": UA, accept: "text/html" } });
      if (res.status >= 300 && res.status < 400) {
        const next = new URL(res.headers.get("location") || "/", url);
        if (!sameSite(next.hostname, domain)) return { verdict: "redirection", info: next.hostname };
        url = next.href;
        continue;
      }
      if (!(res.headers.get("content-type") || "").includes("html")) return { verdict: "pas-de-page", info: String(res.status) };
      const reader = res.body.getReader();
      let html = "";
      const dec = new TextDecoder();
      while (html.length < 65_536) {
        const { done, value } = await reader.read();
        if (done) break;
        html += dec.decode(value, { stream: true });
      }
      ctl.abort();
      return { verdict: "lu", html, status: res.status };
    } catch (e) {
      return { verdict: "injoignable", info: e.name };
    } finally { clearTimeout(timer); }
  }
  return { verdict: "injoignable", info: "trop de redirections" };
}

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
function extract(html) {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const meta = (name) => decode(html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)`, "i"))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i"))?.[1] ?? "");
  return { title, desc: meta("description") || meta("og:description"), rating: meta("rating").toLowerCase(), keywords: meta("keywords") };
}

const ADULT = /porn|porno|sex|xxx|adult|18\+|\b18 ?(years|ans|år|jahre)|nsfw|erotic|érotique|nude|naked|hentai|escort|webcam|cam ?girl|onlyfans|milf|fetish|bdsm|секс|порно|эрот|18歳|アダルト|エロ|成人|色情|黄色|无码|av女优|야동|성인|หนังโป๊|โป๊|เย็ด|phim sex|bokep|ngentot|chudai|sexo|caliente|putas|culo|tetas|fick|geil|verified ?age|age verification|vérification de l'âge|you must be 18|must be over 18|plus de 18 ans/i;

const out = [];
let n = 0;
const queue = [...targets];
await Promise.all(Array.from({ length: 20 }, async () => {
  while (queue.length) {
    const d = queue.shift();
    const r = await readHead(d);
    let verdict = r.verdict, title = "", desc = r.info ?? "";
    if (r.verdict === "lu") {
      const e = extract(r.html);
      title = e.title; desc = e.desc;
      const adult = e.rating === "adult" || e.rating.includes("rta-5042") || ADULT.test(`${e.title} ${e.desc} ${e.keywords}`)
        || /you must be 18|age verification|are you 18|over 18|18\+|plus de 18 ans/i.test(r.html);
      verdict = adult ? "adulte" : (title || desc) ? "neutre" : "vide";
    }
    out.push([rank.get(d), d, verdict, title.slice(0, 120), desc.slice(0, 160)].join("\t"));
    if (++n % 100 === 0) console.log(`  ${n}/${targets.length}`);
  }
}));
out.sort((a, b) => Number(a.split("\t")[0]) - Number(b.split("\t")[0]));
writeFileSync(join(CACHE, "scan-doubt.tsv"), out.join("\n") + "\n");
const count = (v) => out.filter((l) => l.split("\t")[2] === v).length;
console.log(`Terminé : adulte ${count("adulte")}, neutre ${count("neutre")}, vide ${count("vide")}, ` +
  `redirection ${count("redirection")}, injoignable ${count("injoignable")}, pas-de-page ${count("pas-de-page")}`);
