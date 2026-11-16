(async () => {
  const s = await send("summary");
  document.getElementById("days").textContent = s.daysClean;
  document.getElementById("days-label").textContent = plural(s.daysClean, "dayClean", "daysClean");
  if (s.blockedCount != null) document.getElementById("count").textContent = t("sitesBlockedN", [s.blockedCount.toLocaleString()]);
  if (s.activeUnlocks.length) {
    const el = document.getElementById("unlocked");
    const u = s.activeUnlocks[0];
    el.textContent = t("unlockedUntil", [u.domain, new Date(u.expiresAt).toLocaleTimeString()]);
    el.classList.remove("hidden");
  }
  document.getElementById("options").onclick = () => chrome.runtime.openOptionsPage();
})();
