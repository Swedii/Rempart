// Rempart — s'exécute sur toutes les pages.
// 1) Détecte les sites adultes absents des listes : la plupart portent la balise RTA
//    (« Restricted To Adults ») ou <meta name="rating" content="adult">. Le domaine est alors appris et bloqué.
// 2) Floute les images des recherches d'images (un clic sur une image la révèle).
(() => {
  if (window.top !== window) return;

  // ---------- 1. Balise « contenu adulte » ----------
  const RTA = "rta-5042-1996-1400-1577-rta";
  // Seulement les deux étiquettes sans ambiguïté : « mature » ou « restricted » sont aussi utilisées par des sites
  // de jeux vidéo ou de fanfictions, ce qui créerait des faux positifs.
  const ADULT_RATINGS = new Set(["adult", RTA]);

  function isAdultPage() {
    for (const m of document.querySelectorAll('meta[name="rating" i], meta[http-equiv="rating" i], meta[name="RATING"]')) {
      const c = (m.getAttribute("content") || "").trim().toLowerCase();
      if (ADULT_RATINGS.has(c) || c.includes(RTA)) return true;
    }
    return false;
  }

  let reported = false;
  function check() {
    if (reported || !document.head) return;
    if (isAdultPage()) {
      reported = true;
      document.documentElement.style.visibility = "hidden";
      chrome.runtime.sendMessage({ type: "adultDetected" }).then((r) => {
        if (!r?.ok) document.documentElement.style.visibility = "";
      }).catch(() => { document.documentElement.style.visibility = ""; });
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", check, { once: true });
    // La balise est dans <head> : on vérifie aussi dès que le <head> se remplit.
    const mo = new MutationObserver(() => { check(); if (reported || document.body) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } else check();

  // ---------- 2. Recherches d'images floutées ----------
  function isImageSearch(u) {
    const h = u.hostname, p = u.pathname, q = u.searchParams;
    if (/(^|\.)google\.[a-z.]+$/.test(h)) return q.get("tbm") === "isch" || q.get("udm") === "2" || p.startsWith("/imgres");
    if (/(^|\.)bing\.com$/.test(h)) return p.startsWith("/images");
    if (/(^|\.)duckduckgo\.com$/.test(h)) return q.get("ia") === "images" || q.get("iax") === "images";
    if (/(^|\.)yandex\.[a-z]+$/.test(h)) return p.startsWith("/images");
    if (h === "search.brave.com") return p.startsWith("/images");
    if (/(^|\.)ecosia\.org$/.test(h)) return p.startsWith("/images");
    if (/(^|\.)qwant\.com$/.test(h)) return q.get("t") === "images";
    if (/(^|\.)startpage\.com$/.test(h)) return q.get("cat") === "images";
    if (/(^|\.)yahoo\.com$/.test(h)) return h.startsWith("images.");
    return false;
  }

  const STYLE_ID = "rempart-blur";
  const CSS = `
    img:not([data-rempart-shown]), video:not([data-rempart-shown]) {
      filter: blur(28px) !important; transition: filter .15s ease;
    }
    img[data-rempart-shown], video[data-rempart-shown] { filter: none !important; }
  `;

  function applyBlur() {
    const on = isImageSearch(new URL(location.href));
    const existing = document.getElementById(STYLE_ID);
    if (on && !existing) {
      const st = document.createElement("style");
      st.id = STYLE_ID;
      st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    } else if (!on && existing) existing.remove();
  }

  // Premier clic sur une image floutée : on la révèle seulement (le clic ne fait rien d'autre).
  document.addEventListener("click", (e) => {
    if (!document.getElementById(STYLE_ID)) return;
    const el = e.target instanceof Element && e.target.closest("img, video");
    if (el && !el.hasAttribute("data-rempart-shown")) {
      e.preventDefault();
      e.stopImmediatePropagation();
      el.setAttribute("data-rempart-shown", "");
    }
  }, true);

  applyBlur();
  // Les moteurs changent d'onglet sans recharger la page : on surveille l'adresse.
  let lastHref = location.href;
  setInterval(() => { if (location.href !== lastHref) { lastHref = location.href; applyBlur(); } }, 500);
})();
