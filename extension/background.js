// Rempart — script d'arrière-plan.
// Garde l'état (compteur, niveau d'attente, accès temporaires), vérifie le parcours de déverrouillage
// côté arrière-plan (la page ne peut pas tricher sur le temps d'attente) et gère les règles dynamiques.

const DAY = 86_400_000;
const MIN = 60_000;
const RESET_AFTER = 7 * DAY;     // le niveau d'attente revient à 0 après 7 jours sans déverrouillage
const MAX_LEVEL = 4;             // attente max = base × 16 (30 min → 8 h)
const MIN_ANSWER = 50;           // caractères minimum par réponse de réflexion
const MIN_SELF_MESSAGE = 300;    // longueur du texte à recopier

const RULE_LEARNED = 1;          // règle dynamique : domaines appris (balise « adulte » détectée)
const RULE_ALLOWED = 2;          // règle dynamique : faux positifs autorisés par l'utilisateur (après 24 h)
const ALLOWED_PRIORITY = 50;      // au-dessus des blocages (1), en dessous des accès temporaires (100)
const ALLOW_DELAY = DAY;          // délai avant qu'une autorisation de faux positif prenne effet
const RULE_UNLOCK_BASE = 100;    // règles dynamiques : accès temporaires (id ≥ 100)
const UNLOCK_PRIORITY = 100;

const ALL_TYPES = ["main_frame", "sub_frame", "image", "media", "script", "xmlhttprequest",
  "stylesheet", "font", "object", "websocket", "ping", "other"];

const DEFAULT_SETTINGS = { baseWaitMin: 30, accessMin: 10, selfMessage: "" };
const LIMITS = { baseWaitMaxMin: 24 * 60, accessMinMin: 1 };

// ---------- utilitaires ----------

const local = chrome.storage.local;
const session = chrome.storage.session;

const hostOf = (url) => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
};
const normalizeText = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const pageUrl = (page, params = {}) => {
  const u = new URL(chrome.runtime.getURL(`pages/${page}.html`));
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.href;
};

async function getState() {
  const s = await local.get(["installedAt", "lastUnlockAt", "level", "settings", "learned", "unlocks", "journal", "allowed", "pendingAllows"]);
  return {
    installedAt: s.installedAt ?? Date.now(),
    lastUnlockAt: s.lastUnlockAt ?? null,
    level: s.level ?? 0,
    settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) },
    learned: s.learned ?? [],
    unlocks: s.unlocks ?? {},
    journal: s.journal ?? [],
    allowed: s.allowed ?? [],
    pendingAllows: s.pendingAllows ?? {},
  };
}

function effectiveLevel(st, now = Date.now()) {
  if (!st.lastUnlockAt || now - st.lastUnlockAt >= RESET_AFTER) return 0;
  return Math.min(st.level, MAX_LEVEL);
}

function waitMsFor(st, now = Date.now()) {
  return st.settings.baseWaitMin * MIN * 2 ** effectiveLevel(st, now);
}

function copyTextFor(st) {
  const own = normalizeText(st.settings.selfMessage);
  return own.length >= MIN_SELF_MESSAGE ? own : normalizeText(chrome.i18n.getMessage("copyTextDefault"));
}

// ---------- règles dynamiques ----------

async function syncLearnedRule(learned) {
  const addRules = learned.length ? [{
    id: RULE_LEARNED, priority: 1,
    action: { type: "redirect", redirect: { extensionPath: "/pages/blocked.html" } },
    condition: { requestDomains: learned, resourceTypes: ALL_TYPES },
  }] : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE_LEARNED], addRules });
}

/** Retire les accès expirés (règles + alarmes) et recrée les alarmes manquantes. */
async function syncUnlocks() {
  const st = await getState();
  const now = Date.now();
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const remove = [];
  const unlocks = {};
  for (const r of rules) {
    if (r.id < RULE_UNLOCK_BASE) continue;
    const u = st.unlocks[r.id];
    if (!u || u.expiresAt <= now) remove.push(r.id);
    else {
      unlocks[r.id] = u;
      chrome.alarms.create(`unlock-${r.id}`, { when: u.expiresAt });
    }
  }
  if (remove.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: remove });
  await local.set({ unlocks });
  for (const id of remove) await relockTabs(st.unlocks[id]?.domain);
}

async function relockTabs(domain) {
  if (!domain) return;
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    const h = t.url && hostOf(t.url);
    if (h && (h === domain || h.endsWith("." + domain))) {
      chrome.tabs.update(t.id, { url: pageUrl("blocked", { u: t.url }) }).catch(() => {});
    }
  }
}

async function grantAccess(domain, minutes) {
  const st = await getState();
  const used = new Set(Object.keys(st.unlocks).map(Number));
  let id = RULE_UNLOCK_BASE;
  while (used.has(id)) id++;
  const expiresAt = Date.now() + minutes * MIN;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [id],
    addRules: [{
      id, priority: UNLOCK_PRIORITY,
      action: { type: "allowAllRequests" },
      condition: { requestDomains: [domain], resourceTypes: ["main_frame", "sub_frame"] },
    }],
  });
  st.unlocks[id] = { domain, expiresAt };
  await local.set({ unlocks: st.unlocks });
  chrome.alarms.create(`unlock-${id}`, { when: expiresAt });
  return expiresAt;
}

// ---------- parcours de déverrouillage ----------

async function getParcours() {
  return (await session.get("parcours")).parcours ?? {};
}

async function startParcours(tabId, domain) {
  const st = await getState();
  const parcours = await getParcours();
  const now = Date.now();
  parcours[tabId] = { domain, startedAt: now, waitMs: waitMsFor(st, now) };
  await session.set({ parcours });
  return { ...parcours[tabId], now, copyText: copyTextFor(st) };
}

async function completeParcours(tabId, { domain, answers, copied }) {
  const parcours = await getParcours();
  const p = parcours[tabId];
  const now = Date.now();
  if (!p || p.domain !== domain) return { ok: false, error: "noParcours" };
  if (now - p.startedAt < p.waitMs - 1500) return { ok: false, error: "tooEarly", remainingMs: p.waitMs - (now - p.startedAt) };
  if (!Array.isArray(answers) || answers.length !== 3 || answers.some((a) => normalizeText(a).length < MIN_ANSWER)) {
    return { ok: false, error: "answers" };
  }
  const st = await getState();
  if (normalizeText(copied) !== copyTextFor(st)) return { ok: false, error: "copy" };

  delete parcours[tabId];
  await session.set({ parcours });
  const journal = [...st.journal, { at: now, domain, answers: answers.map(normalizeText) }].slice(-200);
  await local.set({ level: effectiveLevel(st, now) + 1, lastUnlockAt: now, journal });
  const expiresAt = await grantAccess(domain, st.settings.accessMin);
  return { ok: true, expiresAt };
}

// ---------- réglages (seulement dans le sens le plus strict) ----------

async function saveSettings(next) {
  const st = await getState();
  const cur = st.settings;
  const out = { ...cur };
  const errors = [];

  const wait = Number(next.baseWaitMin);
  if (Number.isFinite(wait) && wait !== cur.baseWaitMin) {
    if (wait < cur.baseWaitMin || wait > LIMITS.baseWaitMaxMin) errors.push("baseWaitMin");
    else out.baseWaitMin = Math.round(wait);
  }
  const access = Number(next.accessMin);
  if (Number.isFinite(access) && access !== cur.accessMin) {
    if (access > cur.accessMin || access < LIMITS.accessMinMin) errors.push("accessMin");
    else out.accessMin = Math.round(access);
  }
  if (typeof next.selfMessage === "string") {
    const msg = normalizeText(next.selfMessage);
    if (msg && msg.length < MIN_SELF_MESSAGE) errors.push("selfMessage");
    else out.selfMessage = msg;
  }
  await local.set({ settings: out });
  return { ok: errors.length === 0, errors, settings: out };
}

// ---------- détection de pages adultes (balise RTA / rating) ----------

// ---------- faux positifs : autorisation après 24 h ----------
// Un site bloqué par erreur peut être autorisé ; l'autorisation ne prend effet qu'après 24 h (un vrai faux positif
// peut attendre, une envie non). Le compteur n'est pas touché. Annuler ou retirer est immédiat (plus strict).

async function syncAllowedRule(allowed) {
  const addRules = allowed.length ? [{
    id: RULE_ALLOWED, priority: ALLOWED_PRIORITY,
    action: { type: "allowAllRequests" },
    condition: { requestDomains: allowed, resourceTypes: ["main_frame", "sub_frame"] },
  }] : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE_ALLOWED], addRules });
}

/** Active les autorisations dont le délai est écoulé et recrée les alarmes des autres. */
async function activatePendingAllows() {
  const st = await getState();
  const now = Date.now();
  const pending = { ...st.pendingAllows };
  const allowed = new Set(st.allowed);
  for (const [domain, activeAt] of Object.entries(pending)) {
    if (activeAt <= now) { allowed.add(domain); delete pending[domain]; }
    else chrome.alarms.create(`allow-${domain}`, { when: activeAt });
  }
  const learned = st.learned.filter((d) => !allowed.has(d));
  await local.set({ pendingAllows: pending, allowed: [...allowed], learned });
  await syncAllowedRule([...allowed]);
  if (learned.length !== st.learned.length) await syncLearnedRule(learned);
}

async function requestAllow(domain) {
  if (!domain || !/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(domain)) return { ok: false, error: "domain" };
  const st = await getState();
  if (st.allowed.includes(domain)) return { ok: true, activeAt: 0 };
  const activeAt = st.pendingAllows[domain] ?? Date.now() + ALLOW_DELAY;
  await local.set({ pendingAllows: { ...st.pendingAllows, [domain]: activeAt } });
  chrome.alarms.create(`allow-${domain}`, { when: activeAt });
  return { ok: true, activeAt };
}

async function revokeAllow(domain) {
  const st = await getState();
  const pending = { ...st.pendingAllows };
  delete pending[domain];
  const allowed = st.allowed.filter((d) => d !== domain);
  await chrome.alarms.clear(`allow-${domain}`);
  await local.set({ pendingAllows: pending, allowed });
  await syncAllowedRule(allowed);
  await relockTabs(domain);
  return { ok: true };
}

async function learnDomain(domain) {
  const st = await getState();
  if (st.learned.includes(domain) || st.allowed.includes(domain)) return;
  const learned = [...st.learned, domain].slice(-5000);
  await local.set({ learned });
  await syncLearnedRule(learned);
}

/** Vrai si le site est en accès temporaire ou autorisé comme faux positif. */
async function isUnlocked(host) {
  const { unlocks, allowed } = await getState();
  const now = Date.now();
  const match = (d) => host === d || host.endsWith("." + d);
  return allowed.some(match) || Object.values(unlocks).some((u) => u.expiresAt > now && match(u.domain));
}

// ---------- résumé pour les pages ----------

async function summary() {
  const st = await getState();
  const now = Date.now();
  const since = st.lastUnlockAt ?? st.installedAt;
  let count = null;
  try { count = (await (await fetch(chrome.runtime.getURL("rules/meta.json"))).json()).count; } catch {}
  const last = st.journal[st.journal.length - 1];
  return {
    daysClean: Math.floor((now - since) / DAY),
    since,
    waitMs: waitMsFor(st, now),
    level: effectiveLevel(st, now),
    settings: st.settings,
    blockedCount: count + st.learned.length,
    learnedCount: st.learned.length,
    lastAnswers: last ? { at: last.at, answers: last.answers } : null,
    activeUnlocks: Object.values(st.unlocks).filter((u) => u.expiresAt > now),
    journal: st.journal,
    learned: st.learned,
    allowed: st.allowed,
    pendingAllows: st.pendingAllows,
    version: chrome.runtime.getManifest().version,
  };
}

// ---------- événements ----------

chrome.runtime.onInstalled.addListener(async () => {
  const { installedAt } = await local.get("installedAt");
  if (!installedAt) await local.set({ installedAt: Date.now() });
  const st = await getState();
  await syncLearnedRule(st.learned);
  await syncUnlocks();
  await activatePendingAllows();
});

chrome.runtime.onStartup.addListener(async () => {
  await syncUnlocks();
  await activatePendingAllows();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith("unlock-")) await syncUnlocks();
  if (alarm.name.startsWith("allow-")) await activatePendingAllows();
});

// Mémorise l'adresse demandée par chaque onglet : quand une règle redirige vers la page de blocage,
// celle-ci retrouve ainsi le site d'origine.
chrome.webNavigation.onBeforeNavigate.addListener(async ({ tabId, frameId, url }) => {
  if (frameId !== 0 || !/^https?:/.test(url)) return;
  const { lastNav = {} } = await session.get("lastNav");
  lastNav[tabId] = url;
  await session.set({ lastNav });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { lastNav = {}, parcours = {} } = await session.get(["lastNav", "parcours"]);
  delete lastNav[tabId];
  delete parcours[tabId];
  await session.set({ lastNav, parcours });
});

const handlers = {
  summary: () => summary(),
  blockedUrl: async (_msg, sender) => {
    const { lastNav = {} } = await session.get("lastNav");
    return { url: lastNav[sender.tab?.id] ?? null };
  },
  startParcours: (msg, sender) => startParcours(sender.tab.id, msg.domain),
  completeParcours: (msg, sender) => completeParcours(sender.tab.id, msg),
  saveSettings: (msg) => saveSettings(msg.settings ?? {}),
  requestAllow: (msg) => requestAllow(String(msg.domain ?? "").toLowerCase()),
  revokeAllow: (msg) => revokeAllow(String(msg.domain ?? "").toLowerCase()),
  // Envoyé par content/page-guard.js quand une page porte une balise « contenu adulte ».
  adultDetected: async (_msg, sender) => {
    const host = sender.tab && sender.frameId === 0 ? hostOf(sender.url) : null;
    if (!host || await isUnlocked(host)) return { ok: false };
    await learnDomain(host);
    await chrome.tabs.update(sender.tab.id, { url: pageUrl("blocked", { u: sender.url }) });
    return { ok: true };
  },
  // Envoyé par les scripts des réseaux sociaux : contenu adulte dans une plateforme filtrée.
  filtered: async (msg, sender) => {
    if (!sender.tab) return { ok: false };
    await chrome.tabs.update(sender.tab.id, { url: pageUrl("filtered", { u: sender.url, r: msg.reason }) });
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  // Seules les pages de l'extension peuvent piloter le parcours et les réglages.
  const fromExtension = sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(""));
  if (["startParcours", "completeParcours", "saveSettings", "summary", "blockedUrl", "requestAllow", "revokeAllow"].includes(msg.type) && !fromExtension) {
    sendResponse({ ok: false, error: "forbidden" });
    return false;
  }
  Promise.resolve(h(msg, sender)).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
