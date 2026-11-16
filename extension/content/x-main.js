// Rempart — X / Twitter. S'exécute dans le contexte de la page (world: MAIN) avant ses scripts.
// X marque lui-même les médias à contenu adulte (sensitive_media_warning.adult_content).
// On intercepte les réponses de son API et on retire photos, vidéos et cartes de ces tweets,
// même si le compte a désactivé les avertissements. Le texte reste ; les médias disparaissent.
// Règle du projet : dans le doute, on laisse visible. « possibly_sensitive » ou un compte classé « sensible »
// couvrent aussi la violence d'actualité : ce n'est pas une preuve de contenu adulte, on n'y touche pas.
(() => {
  const API_RE = /\/(i\/api|graphql)\//;

  function isAdultTweet(t) {
    const l = t.legacy;
    if (!l || typeof l !== "object") return false;
    const media = l.extended_entities?.media ?? l.entities?.media ?? [];
    return media.some((m) => m.sensitive_media_warning?.adult_content === true);
  }

  function stripMedia(t) {
    const l = t.legacy;
    delete l.extended_entities;
    if (l.entities) l.entities.media = [];
    delete t.card;
    if (Array.isArray(l.entities?.urls)) {
      l.entities.urls = l.entities.urls.filter((u) => !/redgifs|onlyfans|pornhub|xvideos/i.test(u.expanded_url || ""));
    }
  }

  function clean(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 60) return;
    if (Array.isArray(node)) { for (const n of node) clean(n, depth + 1); return; }
    if (node.legacy && (node.__typename === "Tweet" || node.rest_id) && isAdultTweet(node)) stripMedia(node);
    // Format ancien (v1.1) : tweets à plat ; même règle (média marqué adulte).
    const flatMedia = node.extended_entities?.media ?? [];
    if (flatMedia.some((m) => m.sensitive_media_warning?.adult_content === true)) {
      delete node.extended_entities;
      if (node.entities) node.entities.media = [];
    }
    for (const k in node) clean(node[k], depth + 1);
  }

  function transform(text) {
    try {
      const data = JSON.parse(text);
      clean(data);
      return JSON.stringify(data);
    } catch { return text; }
  }

  // ---------- fetch ----------
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await origFetch.call(this, input, init);
    const url = typeof input === "string" ? input : input?.url ?? "";
    const type = res.headers.get("content-type") || "";
    if (!API_RE.test(url) || !type.includes("json")) return res;
    const body = transform(await res.clone().text());
    const out = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    Object.defineProperty(out, "url", { value: res.url });
    return out;
  };

  // ---------- XMLHttpRequest ----------
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const urls = new WeakMap();
  const cache = new WeakMap();
  XHR.open = function (method, url, ...rest) {
    urls.set(this, String(url));
    return origOpen.call(this, method, url, ...rest);
  };
  const desc = (name) => Object.getOwnPropertyDescriptor(XHR, name);
  const textDesc = desc("responseText");
  const respDesc = desc("response");

  function cleaned(xhr) {
    if (cache.has(xhr)) return cache.get(xhr);
    const raw = textDesc.get.call(xhr);
    const out = transform(raw);
    cache.set(xhr, out);
    return out;
  }
  const applies = (xhr) => xhr.readyState === 4 && API_RE.test(urls.get(xhr) || "") &&
    (xhr.responseType === "" || xhr.responseType === "text" || xhr.responseType === "json");

  Object.defineProperty(XHR, "responseText", {
    ...textDesc,
    get() {
      if (!applies(this) || this.responseType === "json") return textDesc.get.call(this);
      return cleaned(this);
    },
  });
  Object.defineProperty(XHR, "response", {
    ...respDesc,
    get() {
      if (!applies(this)) return respDesc.get.call(this);
      if (this.responseType === "json") {
        const v = respDesc.get.call(this);
        clean(v);
        return v;
      }
      return cleaned(this);
    },
  });
})();
