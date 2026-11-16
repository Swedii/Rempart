// Contenu adulte sur une plateforme filtrée (Reddit, X…) : pas de parcours, on propose de revenir.
const params = new URLSearchParams(location.search);
const u = params.get("u");
let origin = null;
try { origin = new URL(u).origin; } catch {}
const reason = params.get("r");
document.getElementById("reason").textContent = t(`reason_${reason}`) !== `reason_${reason}` ? t(`reason_${reason}`) : "";
document.getElementById("back").onclick = () => (history.length > 1 ? history.back() : origin && location.replace(origin));
document.getElementById("home").onclick = () => origin && location.replace(origin);
if (!origin) document.getElementById("home").classList.add("hidden");
