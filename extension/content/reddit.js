// Rempart — Reddit : on garde Reddit utilisable, on retire le contenu adulte.
// - Subreddit ou profil marqué « 18+ » (over_18) → page « contenu filtré ».
// - Publication NSFW ouverte directement → page « contenu filtré ».
// - Publications NSFW dans les fils (accueil, populaire, recherche, profils) → masquées.
// (La page d'avertissement /over18 de Reddit est déjà redirigée par une règle réseau.)
(() => {
  const html = document.documentElement;
  const cache = new Map(); // "r/nom" ou "user/nom" → true/false

  function communityOf(path) {
    const m = path.match(/^\/(r|user|u)\/([^/?#]+)/i);
    if (!m) return null;
    const kind = m[1].toLowerCase() === "r" ? "r" : "user";
    return `${kind}/${m[2].toLowerCase()}`;
  }

  async function isAdultCommunity(key) {
    if (cache.has(key)) return cache.get(key);
    let adult = false;
    try {
      const res = await fetch(`${location.origin}/${key}/about.json?raw_json=1`, { credentials: "include" });
      if (res.ok) {
        const d = (await res.json())?.data ?? {};
        adult = Boolean(d.over18 || d.over_18 || d.subreddit?.over_18);
      }
    } catch { /* réseau : on laisse passer, le masquage des publications reste actif */ }
    cache.set(key, adult);
    return adult;
  }

  function filterPage(reason) {
    html.classList.add("rempart-hide");
    chrome.runtime.sendMessage({ type: "filtered", reason }).catch(() => {});
  }

  let checkedPath = null;
  async function checkLocation() {
    if (location.pathname === checkedPath) return;
    checkedPath = location.pathname;
    const key = communityOf(location.pathname);
    if (!key) return;
    html.classList.add("rempart-checking");
    const timer = setTimeout(() => html.classList.remove("rempart-checking"), 3000);
    const adult = await isAdultCommunity(key);
    clearTimeout(timer);
    html.classList.remove("rempart-checking");
    if (adult) filterPage("reddit_community");
  }

  // ---------- publications NSFW ----------
  const POST_SEL = "shreddit-post, .thing, [data-testid='post-container'], search-telemetry-tracker, faceplate-tracker[noun='post'], article";

  // Uniquement les marqueurs posés par Reddit lui-même (attribut, classe, badge officiel).
  // Pas de devinette sur le texte ou les liens : dans le doute, la publication reste visible.
  function isNsfwPost(el) {
    if (el.matches?.(".over18, [nsfw], [is-nsfw], [data-nsfw='true'], [data-over18='true']")) {
      const v = el.getAttribute("nsfw") ?? el.getAttribute("is-nsfw");
      if (v === null || v !== "false") return true;
    }
    return Boolean(el.querySelector("shreddit-post[nsfw]:not([nsfw='false']), .nsfw-stamp, shreddit-blurred-container[reason='nsfw'], [data-testid='nsfw-badge']"));
  }

  function isMainPostPage() {
    return /^\/r\/[^/]+\/comments\//i.test(location.pathname) || /^\/comments\//i.test(location.pathname);
  }

  function scan(root = document) {
    for (const el of root.querySelectorAll(POST_SEL)) {
      if (el.dataset.rempartSeen) continue;
      el.dataset.rempartSeen = "1";
      if (!isNsfwPost(el)) continue;
      // Sur la page d'une publication, la première publication est le sujet lui-même.
      if (isMainPostPage() && el === document.querySelector("shreddit-post, .thing.link")) {
        filterPage("reddit_post");
        return;
      }
      el.classList.add("rempart-hidden-post");
    }
  }

  let pending = false;
  const mo = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; scan(); checkLocation(); });
  });

  checkLocation();
  const start = () => { scan(); mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["nsfw"] }); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
