// Page de blocage + parcours de déverrouillage.
// Le temps d'attente et le texte recopié sont revérifiés par l'arrière-plan : cette page ne fait qu'afficher.

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => el.classList.toggle("hidden", !on);

// Adresse de création d'un signalement public (ex. « https://github.com/<compte>/rempart/issues/new »).
// Vide tant que le dépôt public n'existe pas : le bouton « Signaler » reste alors masqué.
const REPORT_ISSUE_URL = "https://github.com/Swedii/rempart/issues/new";

const QUESTION_KEYS =["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"];
const MIN_ANSWER = 50;
const CAPTCHAS = 5;

let targetUrl = null;
let domain = null;
let info = null;

const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } };

async function currentTabId() {
  return (await chrome.tabs.getCurrent())?.id;
}

async function closeTab() {
  const id = await currentTabId();
  if (id !== undefined) chrome.tabs.remove(id);
  else window.close();
}

// ---------- Écran 1 ----------

async function init() {
  const params = new URLSearchParams(location.search);
  targetUrl = params.get("u") || (await send("blockedUrl")).url;
  domain = targetUrl && hostOf(targetUrl);
  $("domain").textContent = domain || t("unknownSite");
  if (!domain) show($("want-access").parentElement, false);

  info = await send("summary");
  $("days").textContent = info.daysClean;
  $("days-label").textContent = plural(info.daysClean, "dayClean", "daysClean");
  $("since").textContent = t("sinceDate", [new Date(info.since).toLocaleDateString()]);
  if (info.lastAnswers?.answers?.length) {
    // On rappelle la réponse la plus parlante : celle sur « après ».
    const a = info.lastAnswers.answers;
    $("last-answer").textContent = `« ${a[a.length - 1]} »`;
    show($("last-words"));
  }
  $("start-explain").textContent = t("startExplain", [minutesLabel(info.waitMs), daysText(info.daysClean)]);

  if (!domain) show($("fp-link").parentElement, false);
  show($("fp-report"), Boolean(REPORT_ISSUE_URL));
  const pendingAt = info.pendingAllows?.[domain];
  if (pendingAt) showAllowPending(pendingAt);
}

// ---------- Faux positif ----------

function showAllowPending(activeAt) {
  $("fp-allow").disabled = true;
  $("fp-status").textContent = t("fpPending", [new Date(activeAt).toLocaleString()]);
}

$("fp-link").onclick = () => { show($("fp-panel")); $("fp-panel").scrollIntoView({ behavior: "smooth" }); };

$("fp-allow").onclick = async () => {
  const r = await send("requestAllow", { domain });
  if (r?.ok) showAllowPending(r.activeAt);
};

$("fp-report").onclick = () => {
  const learned = info.learned?.some((d) => domain === d || domain.endsWith("." + d));
  const body = [
    `Domaine / Domain: ${domain}`,
    `Source: ${learned ? "balise adulte détectée (RTA / rating)" : "liste OISD NSFW"}`,
    `Version: ${info.version}`,
    "",
    "Ce que propose ce site / What this site is about:",
    "",
  ].join("\n");
  const url = new URL(REPORT_ISSUE_URL);
  // Le modèle .github/ISSUE_TEMPLATE/faux-positif.md pose l'étiquette pour tout le monde
  // (le paramètre « labels » seul n'est appliqué que pour les membres du dépôt).
  url.searchParams.set("template", "faux-positif.md");
  url.searchParams.set("title", `Faux positif : ${domain}`);
  url.searchParams.set("labels", "faux-positif");
  url.searchParams.set("body", body);
  chrome.tabs.create({ url: url.href });
};

$("close-tab").onclick = closeTab;
$("proud-close").onclick = closeTab;
$("go-back").onclick = () => (history.length > 1 ? history.back() : closeTab());
$("want-access").onclick = () => { show($("confirm-start")); $("confirm-start").scrollIntoView({ behavior: "smooth" }); };
$("cancel-start").onclick = () => show($("confirm-start"), false);
$("start").onclick = startParcours;
$("abandon").onclick = abandon;
$("final-leave").onclick = abandon;

function abandon() {
  show($("screen-parcours"), false);
  show($("screen-blocked"), false);
  show($("screen-proud"));
  stopTimer();
}

// ---------- Écran 2 : parcours ----------

let endAt = 0, totalMs = 0, timerId = null, timeDone = false;
let copyText = "";

async function startParcours() {
  const p = await send("startParcours", { domain });
  if (!p || p.ok === false) return;
  totalMs = p.waitMs;
  endAt = Date.now() + (p.waitMs - (p.now - p.startedAt));
  copyText = p.copyText;
  show($("screen-blocked"), false);
  show($("screen-parcours"));
  window.scrollTo(0, 0);
  buildQuestions();
  buildCopy();
  timerId = setInterval(tick, 1000);
  tick();
  refresh();
}

function stopTimer() { clearInterval(timerId); timerId = null; }

function tick() {
  const left = endAt - Date.now();
  $("timer").textContent = formatDuration(left);
  $("bar-fill").style.width = `${Math.min(100, (1 - left / totalMs) * 100)}%`;
  if (left <= 0 && !timeDone) { timeDone = true; stopTimer(); refresh(); }
}

// Fermer ou recharger la page annule le parcours : on prévient.
window.addEventListener("beforeunload", (e) => { if (timerId) { e.preventDefault(); e.returnValue = ""; } });

// Étape 1 : questions
function buildQuestions() {
  // Deux questions tirées au hasard + toujours « comment je me sentirai après » en dernier :
  // c'est cette réponse qui est rappelée sur la page de blocage la fois suivante.
  const pool = QUESTION_KEYS.filter((k) => k !== "q8");
  const picked = [];
  while (picked.length < 2) picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  picked.push("q8");
  const box = $("questions");
  box.textContent = "";
  for (const key of picked) {
    const wrap = document.createElement("div");
    wrap.className = "question";
    const label = document.createElement("label");
    label.textContent = t(key);
    const ta = document.createElement("textarea");
    ta.className = "answer";
    const counter = document.createElement("div");
    counter.className = "counter";
    ta.addEventListener("input", () => {
      const n = ta.value.replace(/\s+/g, " ").trim().length;
      counter.textContent = t("charsCount", [String(Math.min(n, MIN_ANSWER)), String(MIN_ANSWER)]);
      counter.classList.toggle("ok", n >= MIN_ANSWER);
      refresh();
    });
    ta.dispatchEvent(new Event("input"));
    wrap.append(label, ta, counter);
    box.append(wrap);
  }
}

const answers = () => [...document.querySelectorAll(".answer")].map((a) => a.value);
const answersOk = () => answers().length === 3 && answers().every((a) => a.replace(/\s+/g, " ").trim().length >= MIN_ANSWER);

// Étape 2 : texte à recopier (sans coller)
function buildCopy() {
  const src = $("copy-source");
  src.textContent = "";
  for (const ch of copyText) {
    const s = document.createElement("span");
    s.textContent = ch;
    src.append(s);
  }
  const input = $("copy-input");
  for (const ev of ["paste", "drop", "copy", "cut", "contextmenu"]) {
    input.addEventListener(ev, (e) => e.preventDefault());
    src.addEventListener(ev, (e) => e.preventDefault());
  }
  input.addEventListener("beforeinput", (e) => {
    if (/^insertFrom(Paste|Drop|Yank)|insertReplacementText/.test(e.inputType)) e.preventDefault();
  });
  input.addEventListener("input", () => { paintCopy(); refresh(); });
  paintCopy();
}

const norm = (s) => s.replace(/\s+/g, " ");

function paintCopy() {
  const typed = norm($("copy-input").value);
  const spans = $("copy-source").children;
  let firstBad = -1;
  for (let i = 0; i < spans.length; i++) {
    const c = typed[i];
    spans[i].className = c === undefined ? "" : c === copyText[i] ? "ok" : "bad";
    if (c !== undefined && c !== copyText[i] && firstBad < 0) firstBad = i;
  }
  const done = norm(typed).trim() === copyText;
  $("copy-status").textContent = done ? t("copyDone")
    : firstBad >= 0 ? t("copyError", [String(firstBad + 1)])
    : t("copyProgress", [String(typed.length), String(copyText.length)]);
}
const copyOk = () => norm($("copy-input").value).trim() === copyText;

// Étape 3 : captchas (débloqués quand le temps est écoulé et les étapes 1 et 2 faites)
let captchaCode = "", captchaCount = 0, captchasOk = false;

function nextCaptcha() {
  captchaCode = randomCode();
  drawCaptcha($("captcha"), captchaCode);
  $("captcha-input").value = "";
  const prog = $("captcha-progress");
  prog.textContent = "";
  for (let i = 0; i < CAPTCHAS; i++) {
    const s = document.createElement("span");
    if (i < captchaCount) s.className = "done";
    prog.append(s);
  }
  $("captcha-input").focus();
}

function checkCaptcha() {
  const v = $("captcha-input").value.trim().toUpperCase();
  if (v === captchaCode) {
    captchaCount++;
    $("captcha-error").textContent = "";
    if (captchaCount >= CAPTCHAS) { captchasOk = true; refresh(); return; }
  } else {
    captchaCount = 0;
    $("captcha-error").textContent = t("captchaWrong");
  }
  nextCaptcha();
}
$("captcha-ok").onclick = checkCaptcha;
$("captcha-input").addEventListener("keydown", (e) => { if (e.key === "Enter") checkCaptcha(); });

let captchaStarted = false;
function refresh() {
  const ready = timeDone && answersOk() && copyOk();
  $("captcha-help").textContent = ready ? t("step3Ready", [String(CAPTCHAS)]) : t("step3Locked");
  show($("captcha-zone"), ready && !captchasOk);
  if (ready && !captchaStarted) { captchaStarted = true; nextCaptcha(); }
  $("step-questions").classList.toggle("step-done", answersOk());
  $("step-copy").classList.toggle("step-done", copyOk());
  $("step-captcha").classList.toggle("step-done", captchasOk);
  if (ready && captchasOk) {
    $("final-explain").textContent = t("finalExplain", [daysText(info.daysClean), String(info.settings.accessMin)]);
    show($("step-final"));
  }
}

$("final-access").onclick = async () => {
  const r = await send("completeParcours", { domain, answers: answers(), copied: $("copy-input").value });
  if (!r?.ok) {
    $("final-error").textContent = t("finalFailed", [r?.error ?? "?"]);
    return;
  }
  stopTimer();
  location.replace(targetUrl);
};

init();
