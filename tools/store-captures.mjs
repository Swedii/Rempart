// Captures pour les boutiques (Chrome Web Store, Firefox) : 1280×800 + tuile 440×280, en français et en anglais.
// Charge le VRAI paquet (sortie/rempart-chrome-<version>.zip, voir « npm run package:chrome ») dans un Chrome
// headless, réseau coupé : aucun site n'est contacté, aucune fenêtre n'apparaît à l'écran.
// Usage : npm run captures:store   → store/captures/{fr,en}/*.png

import puppeteer from "puppeteer";
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(join(ROOT, "extension", "manifest.json"), "utf8")).version;
const ZIP = join(ROOT, "sortie", `rempart-chrome-${VERSION}.zip`);
const OUT = join(ROOT, "store", "captures");

// ---------- décompression du paquet (zip écrit par package-extension.mjs) ----------
function unzip(file, dest) {
  const buf = readFileSync(file);
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const name = buf.toString("utf8", p + 30, p + 30 + nameLen);
    const start = p + 30 + nameLen + extraLen;
    const raw = buf.subarray(start, start + size);
    const target = join(dest, ...name.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, method === 8 ? inflateRawSync(raw) : raw);
    p = start + size;
  }
}

// ---------- textes des captures ----------
const TEXTS = {
  fr: {
    shots: [
      ["blocage", "Les sites pornographiques sont bloqués", "≈ 490 000 sites, avec une liste choisie pour son très faible taux de faux positifs. Dans le doute, un site reste accessible."],
      ["parcours", "Un déverrouillage volontairement lent", "30 minutes d'attente, des questions de réflexion, un texte à recopier et des captchas : le temps que l'envie passe."],
      ["reseaux", "Les réseaux sociaux filtrés, pas bloqués", "Reddit et X restent utilisables : seul le contenu marqué « adulte » par la plateforme disparaît. SafeSearch est forcé."],
      ["reglages", "Ton compteur, tes règles", "Réglages modifiables seulement dans le sens le plus strict. Gratuit, open source, aucune donnée ne quitte ton appareil."],
    ],
    tile: "Bloqueur de contenu pornographique",
    tileSub: "Gratuit · open source · aucune donnée collectée",
  },
  en: {
    shots: [
      ["blocage", "Porn sites are blocked", "About 490,000 sites, from a list chosen for its very low false-positive rate. When in doubt, a site stays accessible."],
      ["parcours", "A deliberately slow unlock", "A 30-minute wait, reflection questions, a text to retype and captchas: time for the urge to pass."],
      ["reseaux", "Social networks filtered, not blocked", "Reddit and X stay usable: only content the platform marks as adult disappears. SafeSearch is enforced."],
      ["reglages", "Your streak, your rules", "Settings can only be made stricter. Free, open source, no data ever leaves your device."],
    ],
    tile: "Porn blocker",
    tileSub: "Free · open source · no data collected",
  },
};

const ICON = `data:image/png;base64,${readFileSync(join(ROOT, "extension", "icons", "128.png")).toString("base64")}`;
const png = (b) => `data:image/png;base64,${Buffer.from(b).toString("base64")}`;

const FONT = `font-family: "Segoe UI", system-ui, sans-serif;`;
const frameHtml = (title, sub, shotUrl, side) => `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1280px; height: 800px; overflow: hidden; background: #f4f1ea; ${FONT} color: #1f2a26;
    display: grid; grid-template-columns: 430px 1fr; align-items: center; gap: 48px; padding: 0 64px; }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 22px; color: #2f6b5a; margin-bottom: 36px; }
  .brand img { width: 40px; height: 40px; }
  h1 { font-size: 44px; line-height: 1.12; letter-spacing: -0.01em; margin-bottom: 22px; }
  p { font-size: 21px; line-height: 1.5; color: #5d6b65; }
  .shots { position: relative; display: flex; justify-content: center; }
  .shots.side { justify-content: flex-start; }
  .shots .pop { position: absolute; right: 0; bottom: -36px; }
  .win { background: #fffdf8; border: 1px solid #ddd6c8; border-radius: 16px; overflow: hidden;
    box-shadow: 0 24px 60px rgba(31,42,38,.16), 0 4px 12px rgba(31,42,38,.08); }
  .win .bar { height: 30px; background: #ece7dc; display: flex; gap: 7px; align-items: center; padding: 0 12px; }
  .win .bar i { width: 11px; height: 11px; border-radius: 50%; background: #d3cbbb; }
  .win img { display: block; }
</style>
<div><div class="brand"><img src="${ICON}">Rempart</div><h1>${title}</h1><p>${sub}</p></div>
<div class="shots${side ? " side" : ""}">
  <div class="win"><div class="bar"><i></i><i></i><i></i></div><img src="${shotUrl}" style="width:${side ? 520 : 640}px"></div>
  ${side ? `<div class="win pop"><img src="${side}" style="width:260px"></div>` : ""}
</div>`;

const tileHtml = (title, sub) => `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 440px; height: 280px; overflow: hidden; background: #2f6b5a; color: #fff; ${FONT}
    display: flex; flex-direction: column; justify-content: center; padding: 0 36px; }
  .brand { display: flex; align-items: center; gap: 14px; font-size: 40px; font-weight: 700; margin-bottom: 14px; }
  .brand img { width: 56px; height: 56px; background: #fffdf8; border-radius: 14px; padding: 6px; }
  h1 { font-size: 23px; font-weight: 600; margin-bottom: 8px; }
  p { font-size: 15px; opacity: .85; }
</style><div class="brand"><img src="${ICON}">Rempart</div><h1>${title}</h1><p>${sub}</p>`;

// ---------- prises de vue ----------
const extDir = mkdtempSync(join(tmpdir(), "rempart-captures-"));
unzip(ZIP, extDir);

for (const lang of ["fr", "en"]) {
  const browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [extDir],
    args: ["--host-resolver-rules=MAP * ~NOTFOUND", `--lang=${lang}`, "--force-color-profile=srgb"],
    env: { ...process.env, LANG: lang, LANGUAGE: lang },
  });
  try {
    const sw = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("background.js"), { timeout: 180_000 });
    const extUrl = (p) => `chrome-extension://${new URL(sw.url()).host}/${p}`;
    const page = await browser.newPage();
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);

    const shoot = async (url, width, height, prepare) => {
      await page.setViewport({ width, height, deviceScaleFactor: 2 });
      await page.goto(url, { waitUntil: "load" });
      await new Promise((r) => setTimeout(r, 400));
      if (prepare) await prepare();
      await page.evaluate(() => window.scrollTo(0, 0));
      // Fenêtre recadrée sur le contenu : pas de grand vide sous une page courte.
      const bottom = await page.evaluate(() => Math.ceil(document.querySelector("main")?.getBoundingClientRect().bottom ?? 0));
      return page.screenshot({ clip: { x: 0, y: 0, width, height: Math.min(height, Math.max(bottom, 300)) } });
    };

    const site = "https%3A%2F%2Fsite-adulte.example%2F";
    const raw = {
      blocage: await shoot(extUrl(`pages/blocked.html?u=${site}`), 760, 820),
      parcours: await shoot(extUrl(`pages/blocked.html?u=${site}`), 760, 820, async () => {
        await page.click("#want-access");
        await page.click("#start");
        await new Promise((r) => setTimeout(r, 1500));
      }),
      reseaux: await shoot(extUrl("pages/filtered.html?u=https%3A%2F%2Fwww.reddit.com%2Fr%2Fexemple%2F&r=reddit_community"), 760, 560),
      reglages: await shoot(extUrl("pages/options.html"), 760, 860),
    };
    const popup = await (async () => {
      await page.setViewport({ width: 280, height: 600, deviceScaleFactor: 2 });
      await page.goto(extUrl("popup/popup.html"), { waitUntil: "load" });
      await new Promise((r) => setTimeout(r, 400));
      const h = await page.evaluate(() => Math.ceil(document.documentElement.getBoundingClientRect().height));
      return page.screenshot({ clip: { x: 0, y: 0, width: 280, height: Math.min(h, 600) } });
    })();

    // ---------- mise en page ----------
    mkdirSync(join(OUT, lang), { recursive: true });
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    for (const [i, [key, title, sub]] of TEXTS[lang].shots.entries()) {
      await page.setContent(frameHtml(title, sub, png(raw[key]), key === "reglages" ? png(popup) : null), { waitUntil: "load" });
      await page.screenshot({ path: join(OUT, lang, `${i + 1}-${key}.png`) });
    }
    await page.setViewport({ width: 440, height: 280, deviceScaleFactor: 1 });
    await page.setContent(tileHtml(TEXTS[lang].tile, TEXTS[lang].tileSub), { waitUntil: "load" });
    await page.screenshot({ path: join(OUT, lang, "tuile-440x280.png") });
    console.log(`${lang} : 4 captures 1280×800 + tuile 440×280`);
  } finally {
    await browser.close();
  }
}
rmSync(extDir, { recursive: true, force: true });
