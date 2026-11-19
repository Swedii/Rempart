// Test de bout en bout de l'extension dans un vrai Chrome (Chrome for Testing, headless) ou Firefox (headless).
// Rien ne sort du PC : Chrome a sa résolution DNS coupée (--host-resolver-rules) ; Firefox passe par un proxy
// qui est le mini-serveur local lui-même (HTTPS refusé, DNS jamais utilisé). Aucun site n'est réellement chargé.
// Usage : npm test   ·   npm run test:firefox   (option : SHOTS=dossier pour enregistrer des captures d'écran)

import puppeteer from "puppeteer";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(ROOT, "extension");
const SHOTS = process.env.SHOTS;
const FIREFOX = process.argv.includes("--firefox") || process.env.BROWSER === "firefox";
const FF_UUID = "6c0d4a3e-0000-4000-8000-00000000a11e";        // adresse interne fixe de l'extension dans Firefox
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (cond, label, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} ${label}${!cond && extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

// Mini-serveur local qui joue certains sites (le reste du réseau est coupé).
const PAGES = {
  "pornhub.com": "<!doctype html><title>ok</title><p id=ok>site déverrouillé</p>",
  "rta-page.example": '<!doctype html><head><meta name="rating" content="RTA-5042-1996-1400-1577-RTA"></head><body>adulte</body>',
};
PAGES["x.com"] = "<!doctype html><p>faux X</p>";
PAGES["cdn.xvideos.com"] = "contenu chargé par une page déverrouillée";
PAGES["www.reddit.com"] = "";
const X_API = JSON.stringify({ data: {
  sensible: { __typename: "Tweet", rest_id: "1", legacy: { possibly_sensitive: true,
    extended_entities: { media: [{ id: 1, sensitive_media_warning: { adult_content: true } }] }, entities: { media: [{ id: 1 }], urls: [] } } },
  compteSensible: { __typename: "Tweet", rest_id: "4", core: { user_results: { result: { __typename: "User", legacy: { possibly_sensitive: true } } } },
    legacy: { possibly_sensitive: true, extended_entities: { media: [{ id: 4 }] }, entities: { media: [{ id: 4 }], urls: [] } } },
  violent: { __typename: "Tweet", rest_id: "3", legacy: { possibly_sensitive: true,
    extended_entities: { media: [{ id: 3, sensitive_media_warning: { graphic_violence: true } }] }, entities: { media: [{ id: 3 }], urls: [] } } },
  normal: { __typename: "Tweet", rest_id: "2", legacy: { possibly_sensitive: false, extended_entities: { media: [{ id: 2 }] }, entities: { media: [{ id: 2 }], urls: [] } } },
} });
const REDDIT_FEED = '<!doctype html><body><shreddit-post id="nsfw-post" nsfw>post adulte</shreddit-post><shreddit-post id="safe-post">post normal</shreddit-post>' +
  '<shreddit-post id="mention-post"><span>NSFW</span> ? débat sur le mot</shreddit-post>' +
  '<shreddit-post id="news-post">Article de presse <a href="https://www.pornhub.com/press">lien</a></shreddit-post></body>';
const server = createServer((req, res) => {
  const host = (req.headers.host || "").split(":")[0];
  req.url = new URL(req.url, "http://local").pathname + new URL(req.url, "http://local").search; // proxy (Firefox) : adresse complète
  const json = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(typeof o === "string" ? o : JSON.stringify(o)); };
  if (host === "x.com" && req.url.startsWith("/i/api/graphql/")) return json(X_API);
  if (host === "www.reddit.com") {
    const m = req.url.match(/^\/r\/([^/]+)\/about\.json/);
    if (m) return json({ data: { over18: m[1] === "nsfwtest" } });
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(host === "www.reddit.com" ? REDDIT_FEED : PAGES[host] ?? "<!doctype html><p>page normale</p>");
});
// Firefox : le serveur sert aussi de proxy ; les tunnels HTTPS sont refusés (= « réseau atteint », jamais de vraie sortie).
server.on("connect", (req, socket) => socket.destroy());
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const RESOLVER = Object.keys(PAGES).map((h) => `MAP ${h} 127.0.0.1:${PORT}`).join(", ") + ", MAP * ~NOTFOUND";

const browser = FIREFOX
  ? await puppeteer.launch({
      browser: "firefox",
      headless: true,
      defaultViewport: { width: 900, height: 1100 },
      extraPrefsFirefox: {
        "network.proxy.type": 1, "network.proxy.http": "127.0.0.1", "network.proxy.http_port": PORT,
        "network.proxy.ssl": "127.0.0.1", "network.proxy.ssl_port": PORT,
        "network.proxy.allow_hijacking_localhost": true, "network.proxy.no_proxies_on": "",
        "network.trr.mode": 5, "dom.security.https_first": false, "dom.security.https_only_mode": false,
        "intl.locale.requested": "fr", "intl.accept_languages": "fr",
        "extensions.webextensions.uuids": JSON.stringify({ "rempart@rempart-bloqueur": FF_UUID }),
      },
    })
  : await puppeteer.launch({
      headless: true,
      pipe: true,
      enableExtensions: [EXT],
      args: [`--host-resolver-rules=${RESOLVER}`, "--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable", "--lang=fr", "--window-size=900,1100"],
      defaultViewport: { width: 900, height: 1100 },
    });

try {
  let extUrl, bg;
  if (FIREFOX) {
    await browser.installExtension(EXT);
    extUrl = (p) => `moz-extension://${FF_UUID}/${p}`;
  } else {
    const swTarget = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("background.js"), { timeout: 60_000 });
    const sw = await swTarget.worker();
    const extId = new URL(swTarget.url()).host;
    extUrl = (p) => `chrome-extension://${extId}/${p}`;
    bg = (fn) => sw.evaluate(fn);
  }
  const EXT_PROTOCOL = FIREFOX ? "moz-extension:" : "chrome-extension:";

  // Adresse actuelle d'un onglet (dans Firefox, page.url() ne suit pas les redirections vers l'extension).
  const here = async (p) => (FIREFOX ? p.evaluate(() => location.href).catch(() => p.url()) : p.url());

  const page = await browser.newPage();
  // La page de blocage demande confirmation si on la quitte en plein parcours : on accepte.
  page.on("dialog", (d) => d.accept().catch(() => {}));
  // Bloqué → la navigation aboutit sur la page de l'extension.
  // Non bloqué → la requête part vers le réseau et échoue (DNS coupé / HTTPS refusé) : on renvoie alors l'erreur.
  const visit = async (url, p = page) => {
    if (!FIREFOX) {
      try {
        await p.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
        return p.url();
      } catch (e) {
        return `error:${e.message.split("\n")[0]}`;
      }
    }
    // Firefox : la navigation vers une page d'extension n'est jamais signalée comme finie à l'outil de test.
    // On marque le document actuel, puis on attend un nouveau document chargé.
    await p.evaluate(() => { window.__rempartAncien = true; }).catch(() => {});
    let fini = null;
    p.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 }).then(() => { fini = "ok"; },
      (e) => { fini = `error:${e.message.split("\n")[0]}`; });
    for (const debut = Date.now(); Date.now() - debut < 15_000; await sleep(150)) {
      if (fini?.startsWith("error:") && !fini.includes("timeout")) return fini;
      const etat = await p.evaluate(() => [location.href, !!window.__rempartAncien, document.readyState]).catch(() => null);
      if (etat && !etat[1] && etat[2] !== "loading" && etat[0] !== "about:blank") return etat[0];
    }
    return fini ?? "error:timeout";
  };
  const isBlocked = (u) => u.startsWith(extUrl("pages/blocked.html"));
  // (Firefox garde l'adresse du site sur sa page d'erreur réseau : une adresse web = non bloqué.)
  const reachedNetwork = (u) => FIREFOX ? /^(https?:|error:(?!timeout))/.test(u) : u.startsWith("error:") && u.includes("ERR_NAME_NOT_RESOLVED");

  if (FIREFOX) {
    // Firefox : l'arrière-plan est une page d'événements ; on l'appelle depuis une page de l'extension.
    const bgPage = await browser.newPage();
    await visit(extUrl("pages/options.html"), bgPage);
    bg = async (fn) => {
      await bgPage.evaluate(async () => {
        const g = await browser.runtime.getBackgroundPage();
        window.syncUnlocks = () => g.syncUnlocks();
        window.activatePendingAllows = () => g.activatePendingAllows();
      });
      return bgPage.evaluate(fn);
    };
  }

  // ---- règles chargées ----
  const rulesets = await bg(() => chrome.declarativeNetRequest.getEnabledRulesets());
  ok([1, 2, 3, 4, 5, 6].every((n) => rulesets.includes(`blocklist-${n}`)) && rulesets.includes("safety"), "ensembles de règles actifs", JSON.stringify(rulesets));
  await page.bringToFront();

  const domains = readFileSync(join(ROOT, "data", "blocklist.txt"), "utf8").trim().split("\n");
  const last = domains[domains.length - 1];

  ok(isBlocked(await visit("https://pornhub.com/")), "pornhub.com bloqué");
  ok(isBlocked(await visit("https://fr.pornhub.com/video")), "sous-domaine bloqué");
  ok(isBlocked(await visit(`https://${last}/`)), `dernier domaine de la liste bloqué (${last})`);
  // Faux positifs connus : ne doivent JAMAIS être bloqués (audit du 16/11/2026).
  for (const d of ["b-cdn.net", "cosmopolitan.com", "ekstrabladet.dk", "kinopoisk.ru", "match.com", "vip.com",
                   "x.github.io", "ville-pornic.fr", "cabinporn.com", "yanmaga.jp"]) {
    const u = await visit(`https://${d}/`);
    ok(reachedNetwork(u), `faux positif évité : ${d}`, u);
  }
  ok(reachedNetwork(await visit("https://example.com/")), "example.com non bloqué");
  ok(reachedNetwork(await visit("https://yourbrainonporn.com/")), "site d'aide non bloqué malgré le mot-clé");
  ok(!isBlocked(await visit("http://www.reddit.com/")), "reddit.com non bloqué (filtré seulement)");
  ok((await visit("https://www.reddit.com/over18?dest=https%3A%2F%2Fwww.reddit.com%2Fr%2Fx")).startsWith(extUrl("pages/filtered.html")),
    "page /over18 de Reddit filtrée");

  // ---- SafeSearch ----
  const seen = [];
  const onReq = (r) => seen.push(r.url());
  page.on("request", onReq);
  const S = FIREFOX ? "http" : "https";
  await visit(`${S}://www.google.fr/search?q=test&safe=off`);
  await visit(`${S}://www.bing.com/search?q=test`);
  await visit(`${S}://duckduckgo.com/?q=test`);
  page.off("request", onReq);
  ok(seen.some((u) => u.includes("google.fr/search") && new URL(u).searchParams.get("safe") === "active"), "Google : safe=active forcé", seen.join(" | "));
  ok(seen.some((u) => u.includes("bing.com/search") && new URL(u).searchParams.get("adlt") === "strict"), "Bing : adlt=strict forcé");
  ok(seen.some((u) => u.includes("duckduckgo.com") && new URL(u).searchParams.get("kp") === "1"), "DuckDuckGo : kp=1 forcé");

  // ---- page de blocage + parcours ----
  await visit("https://pornhub.com/");
  await page.waitForSelector("#domain");
  await page.waitForFunction(() => document.getElementById("domain").textContent.length > 0);
  ok(await page.$eval("#domain", (e) => e.textContent) === "pornhub.com", "la page de blocage affiche le domaine");
  ok(await page.$eval("#days", (e) => e.textContent) === "0", "compteur à 0 jour à l'installation");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "1-bloque.png"), fullPage: true });

  await page.click("#want-access");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "2-avant-parcours.png"), fullPage: true });
  await page.click("#start");
  await page.waitForSelector("#screen-parcours:not(.hidden)");
  const timerText = await page.$eval("#timer", (e) => e.textContent);
  ok(/^(29|30):\d\d$/.test(timerText), `minuteur de 30 min (${timerText})`);

  const pageSend = (msg) => page.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  const copyText = await page.$eval("#copy-source", (e) => e.textContent);
  const answers = ["a".repeat(60), "b".repeat(60), "c".repeat(60)];

  let r = await pageSend({ type: "completeParcours", domain: "pornhub.com", answers, copied: copyText });
  ok(r.ok === false && r.error === "tooEarly", "déverrouillage refusé avant la fin de l'attente", JSON.stringify(r));

  // On avance l'horloge du parcours de 30 min côté arrière-plan.
  await bg(async () => {
    const { parcours } = await chrome.storage.session.get("parcours");
    for (const k in parcours) parcours[k].startedAt -= parcours[k].waitMs;
    await chrome.storage.session.set({ parcours });
  });
  r = await pageSend({ type: "completeParcours", domain: "pornhub.com", answers: ["court", "b".repeat(60), "c".repeat(60)], copied: copyText });
  ok(r.error === "answers", "réponse trop courte refusée");
  r = await pageSend({ type: "completeParcours", domain: "pornhub.com", answers, copied: copyText.slice(0, -5) });
  ok(r.error === "copy", "texte mal recopié refusé");

  // Remplissage de l'interface pour la capture d'écran du parcours.
  if (SHOTS) {
    const tas = await page.$$(".answer");
    for (const ta of tas) await ta.type("Je me sens fatigué et seul ce soir, j'ai besoin de me reposer.");
    await page.type("#copy-input", copyText.slice(0, 120));
    await page.screenshot({ path: join(SHOTS, "3-parcours.png"), fullPage: true });
  }

  r = await pageSend({ type: "completeParcours", domain: "pornhub.com", answers, copied: copyText });
  ok(r.ok === true, "parcours complet accepté", JSON.stringify(r));

  const dyn = await bg(() => chrome.declarativeNetRequest.getDynamicRules());
  ok(dyn.some((x) => x.action.type === "allow" && x.condition.requestDomains?.[0] === "pornhub.com"), "accès temporaire créé");
  const ph = await visit("http://pornhub.com/"); await sleep(1000); ok(await here(page) === "http://pornhub.com/" && await page.$("#ok"), "site accessible pendant l'accès temporaire", ph + " | " + await here(page));
  const sousRessource = await page.evaluate(() => fetch("http://cdn.xvideos.com/image", { mode: "no-cors" }).then(() => "chargée", (e) => String(e)));
  ok(sousRessource === "chargée", "le site déverrouillé charge ses images et vidéos (même hébergées ailleurs)", sousRessource);
  // Firefox laissait passer, depuis l'onglet déverrouillé, la navigation vers un autre site bloqué (allowAllRequests).
  const xv = await visit("https://xvideos.com/"); ok(isBlocked(xv), "les autres sites restent bloqués (même onglet)", xv);
  { const t2 = await browser.newPage(); const xv2 = await visit("https://xvideos.com/", t2); await t2.close();
    ok(isBlocked(xv2), "les autres sites restent bloqués (nouvel onglet)", xv2); }
  await visit("http://example.com/");
  { const xv3 = await visit("https://xvideos.com/"); ok(isBlocked(xv3), "les autres sites restent bloqués (même onglet, après un site neutre)", xv3); }

  const ctl = await browser.newPage();
  await visit(extUrl("popup/popup.html"), ctl);
  const sum = await ctl.evaluate(() => chrome.runtime.sendMessage({ type: "summary" }));
  await ctl.close();
  ok(sum.level === 1 && sum.waitMs === 60 * 60_000, `attente suivante doublée (${sum.waitMs / 60000} min)`);
  ok(sum.daysClean === 0 && sum.journal.length === 1, "compteur remis à zéro et journal rempli");

  // Fin de l'accès : on fait expirer et on resynchronise.
  await visit("http://pornhub.com/");
  await bg(async () => {
    const { unlocks } = await chrome.storage.local.get("unlocks");
    for (const k in unlocks) unlocks[k].expiresAt = Date.now() - 1000;
    await chrome.storage.local.set({ unlocks });
    await syncUnlocks();
  });
  await new Promise((res) => setTimeout(res, 1500));
  const reverrouille = await here(page); ok(isBlocked(reverrouille), "onglet reverrouillé à la fin de l'accès", reverrouille);
  ok(isBlocked(await visit("https://pornhub.com/")), "site de nouveau bloqué");

  // ---- réglages (seulement plus strict) ----
  const opt = await browser.newPage();
  await visit(extUrl("pages/options.html"), opt);
  const save = (settings) => opt.evaluate((s) => chrome.runtime.sendMessage({ type: "saveSettings", settings: s }), settings);
  ok((await save({ baseWaitMin: 20 })).ok === false, "attente : baisse refusée");
  ok((await save({ baseWaitMin: 45 })).ok === true, "attente : hausse acceptée");
  ok((await save({ accessMin: 15 })).ok === false, "accès : hausse refusée");
  ok((await save({ selfMessage: "trop court" })).ok === false, "message perso trop court refusé");
  if (SHOTS) await opt.screenshot({ path: join(SHOTS, "4-reglages.png"), fullPage: true });

  // ---- balise RTA : domaine appris ----
  await visit("http://rta-page.example/");
  await page.waitForFunction((pr) => location.protocol === pr, { timeout: 5000 }, EXT_PROTOCOL).catch(() => {});
  const rta = await here(page); ok(isBlocked(rta), "page portant la balise RTA bloquée", rta);
  const learned = (await bg(() => chrome.storage.local.get("learned"))).learned ?? [];
  ok(learned.includes("rta-page.example"), "domaine RTA appris");
  ok(isBlocked(await visit("http://rta-page.example/autre")), "domaine RTA bloqué dès la requête suivante");

  // ---- faux positif : autorisation après 24 h, compteur intact ----
  const ctl2 = await browser.newPage();
  await visit(extUrl("popup/popup.html"), ctl2);
  const summaryNow = () => ctl2.evaluate(() => chrome.runtime.sendMessage({ type: "summary" }));
  const before = await summaryNow();
  await page.bringToFront(); // les clics ne fonctionnent pas dans un onglet en arrière-plan
  await visit("https://pornhub.com/");
  await page.waitForFunction(() => document.getElementById("domain").textContent.length > 0);
  await page.click("#fp-link");
  await page.click("#fp-allow");
  await page.waitForFunction(() => document.getElementById("fp-status").textContent.length > 0);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "5-faux-positif.png"), fullPage: true });
  ok((await summaryNow()).pendingAllows["pornhub.com"] > Date.now() + 23 * 3600_000, "autorisation demandée, effective dans 24 h");
  ok(isBlocked(await visit("https://pornhub.com/")), "site toujours bloqué pendant les 24 h");
  const skip24h = () => bg(async () => {
    const { pendingAllows } = await chrome.storage.local.get("pendingAllows");
    for (const k in pendingAllows) pendingAllows[k] = Date.now() - 1000;
    await chrome.storage.local.set({ pendingAllows });
    await activatePendingAllows();
  });
  await skip24h();
  ok((await visit("http://pornhub.com/")) === "http://pornhub.com/" && await page.$("#ok"), "site autorisé après 24 h");
  const after = await summaryNow();
  ok(after.level === before.level && after.daysClean === before.daysClean && after.journal.length === before.journal.length,
    "autorisation sans effet sur le compteur ni l'attente");
  await ctl2.evaluate(() => chrome.runtime.sendMessage({ type: "revokeAllow", domain: "pornhub.com" }));
  ok(isBlocked(await visit("https://pornhub.com/")), "autorisation retirée : site de nouveau bloqué immédiatement");

  // Faux positif détecté par la balise : l'autoriser le retire des domaines appris.
  await ctl2.evaluate(() => chrome.runtime.sendMessage({ type: "requestAllow", domain: "rta-page.example" }));
  await skip24h();
  ok(!(await summaryNow()).learned.includes("rta-page.example"), "domaine autorisé retiré des domaines appris");
  await visit("http://rta-page.example/");
  await new Promise((res) => setTimeout(res, 1500));
  const rta2 = await here(page); ok(rta2 === "http://rta-page.example/", "domaine autorisé non rebloqué par la balise", rta2);
  await ctl2.close();
  // ---- X : médias des tweets sensibles retirés (fetch et XHR) ----
  await visit("http://x.com/home");
  const x = await page.evaluate(async () => {
    const viaFetch = await (await fetch("/i/api/graphql/abc/HomeTimeline")).json();
    const viaXhr = await new Promise((res) => {
      const r = new XMLHttpRequest();
      r.open("GET", "/i/api/graphql/abc/HomeTimeline");
      r.onload = () => res(JSON.parse(r.responseText));
      r.send();
    });
    const summary = (d) => ({ sensible: d.data.sensible.legacy.entities.media.length + (d.data.sensible.legacy.extended_entities ? 1 : 0),
      normal: d.data.normal.legacy.entities.media.length, violent: d.data.violent.legacy.entities.media.length,
      compteSensible: d.data.compteSensible.legacy.entities.media.length });
    return { fetch: summary(viaFetch), xhr: summary(viaXhr) };
  });
  ok(x.fetch.sensible === 0 && x.fetch.normal === 1 && x.fetch.violent === 1 && x.fetch.compteSensible === 1, "X (fetch) : médias adultes retirés, actualité violente et normaux gardés", JSON.stringify(x.fetch));
  ok(x.xhr.sensible === 0 && x.xhr.normal === 1 && x.xhr.violent === 1 && x.xhr.compteSensible === 1, "X (XHR) : médias adultes retirés, actualité violente et normaux gardés", JSON.stringify(x.xhr));

  // ---- Reddit ----
  await visit("http://www.reddit.com/r/sain/");
  await page.waitForFunction(() => document.querySelector("#safe-post")?.dataset.rempartSeen, { timeout: 5000 }).catch(() => {});
  const rd = await page.evaluate(() => ({
    nsfw: getComputedStyle(document.getElementById("nsfw-post")).display,
    safe: getComputedStyle(document.getElementById("safe-post")).display,
    mention: getComputedStyle(document.getElementById("mention-post")).display,
    news: getComputedStyle(document.getElementById("news-post")).display,
  }));
  ok(rd.mention !== "none" && rd.news !== "none", "Reddit, dans le doute : mot « NSFW » ou lien adulte seuls ne masquent rien", JSON.stringify(rd));
  ok(rd.nsfw === "none" && rd.safe !== "none", "Reddit : publication NSFW masquée, normale visible", JSON.stringify(rd));
  await visit("http://www.reddit.com/r/nsfwtest/");
  await page.waitForFunction((pr) => location.protocol === pr, { timeout: 5000 }, EXT_PROTOCOL).catch(() => {});
  const rd18 = await here(page); ok(rd18.startsWith(extUrl("pages/filtered.html")), "Reddit : communauté 18+ filtrée", rd18);
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} échec(s)` : "\nTout est OK");
process.exit(failures ? 1 : 0);
