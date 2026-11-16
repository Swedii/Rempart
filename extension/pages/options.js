const $ = (id) => document.getElementById(id);
const MIN_SELF = 300;

async function load() {
  const s = await send("summary");
  $("days").textContent = s.daysClean;
  $("wait").textContent = minutesLabel(s.waitMs);
  $("count").textContent = s.blockedCount != null ? s.blockedCount.toLocaleString() : "-";
  $("baseWaitMin").value = s.settings.baseWaitMin;
  $("baseWaitMin").min = s.settings.baseWaitMin;
  $("accessMin").value = s.settings.accessMin;
  $("accessMin").max = s.settings.accessMin;
  $("selfMessage").value = s.settings.selfMessage;
  countSelf();
  renderAllowed(s.allowed, s.pendingAllows);
  renderJournal(s.journal);
}

function renderAllowed(allowed, pending) {
  const box = $("allowed");
  box.textContent = "";
  const rows = [
    ...allowed.map((d) => ({ d, status: t("allowedActive"), button: t("remove") })),
    ...Object.entries(pending).map(([d, at]) => ({ d, status: t("allowedPending", [new Date(at).toLocaleString()]), button: t("cancel") })),
  ];
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = t("allowedEmpty");
    box.append(p);
    return;
  }
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "allowed-row";
    const left = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = r.d;
    const status = document.createElement("div");
    status.className = "small muted";
    status.textContent = r.status;
    left.append(name, status);
    const btn = document.createElement("button");
    btn.className = "secondary";
    btn.textContent = r.button;
    btn.onclick = async () => { await send("revokeAllow", { domain: r.d }); await load(); };
    row.append(left, btn);
    box.append(row);
  }
}

function countSelf() {
  const n = $("selfMessage").value.replace(/\s+/g, " ").trim().length;
  $("selfCount").textContent = t("charsCount", [String(n), String(MIN_SELF)]);
}
$("selfMessage").addEventListener("input", countSelf);

function renderJournal(journal) {
  const box = $("journal");
  box.textContent = "";
  if (!journal.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = t("journalEmpty");
    box.append(p);
    return;
  }
  for (const e of [...journal].reverse()) {
    const div = document.createElement("div");
    div.className = "journal-entry";
    const head = document.createElement("div");
    head.className = "small muted";
    head.textContent = `${new Date(e.at).toLocaleString()} — ${e.domain}`;
    const ul = document.createElement("ul");
    for (const a of e.answers) {
      const li = document.createElement("li");
      li.textContent = a;
      ul.append(li);
    }
    div.append(head, ul);
    box.append(div);
  }
}

$("save").onclick = async () => {
  const r = await send("saveSettings", {
    settings: {
      baseWaitMin: Number($("baseWaitMin").value),
      accessMin: Number($("accessMin").value),
      selfMessage: $("selfMessage").value,
    },
  });
  const out = $("saved");
  out.classList.toggle("error", !r.ok);
  out.textContent = r.ok ? t("savedOk") : r.errors.map((k) => t(`err_${k}`)).join(" ");
  await load();
};

load();
