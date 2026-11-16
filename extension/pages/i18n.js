// Remplit les éléments [data-i18n] (texte) et [data-i18n-ph] (placeholder) avec les messages traduits.
const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

function applyI18n(root = document) {
  document.documentElement.lang = chrome.i18n.getUILanguage().split("-")[0];
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-ph]")) el.placeholder = t(el.dataset.i18nPh);
  for (const el of root.querySelectorAll("[data-i18n-title]")) document.title = t(el.dataset.i18nTitle);
}

const send = (type, data = {}) => chrome.runtime.sendMessage({ type, ...data });

function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Pluriel selon la langue (en français, 0 et 1 sont au singulier).
const pluralRules = new Intl.PluralRules(chrome.i18n.getUILanguage());
const plural = (n, oneKey, otherKey, subs) => t(pluralRules.select(n) === "one" ? oneKey : otherKey, subs);
const daysText = (n) => plural(n, "dayCount", "daysCount", [String(n)]);

function minutesLabel(ms) {
  const min = Math.round(ms / 60000);
  return min >= 60 && min % 60 === 0 ? t("hoursN", [String(min / 60)]) : t("minutesN", [String(min)]);
}

applyI18n();
