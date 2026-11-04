const running = new Set(); // laufende Job-IDs

const session = chrome.storage.session;

// ---- m3u8 sniffing -------------------------------------------------------
chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.tabId < 0) return;
    const key = "m3u8_" + d.tabId;
    session.get(key).then((r) => {
      const list = (r[key] || []).filter((u) => u !== d.url);
      list.push(d.url);
      session.set({ [key]: list.slice(-30) });
    });
  },
  { urls: ["https://*/*.m3u8*"] }
);

chrome.tabs.onRemoved.addListener((id) => session.remove("m3u8_" + id));

// ---- Downloads: Segmente laden + muxen im Offscreen-Dokument, Ergebnis als Chrome-Download ----
async function setJob(id, patch) {
  const r = await session.get("jobs");
  const jobs = r.jobs || {};
  jobs[id] = { ...(jobs[id] || {}), ...patch };
  await session.set({ jobs });
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS"],
    justification: "Videosegmente herunterladen und zu einer MP4 zusammenfügen",
  });
}

async function finishJob(id, patch) {
  running.delete(id);
  await setJob(id, patch);
  chrome.runtime.sendMessage({ target: "offscreen", type: "release", id }).catch(() => {});
  if (!running.size) setTimeout(() => { if (!running.size) chrome.offscreen.closeDocument().catch(() => {}); }, 2000);
}

async function startJob(job) {
  running.add(job.id);
  await setJob(job.id, { id: job.id, name: job.filename, state: "running", percent: 0, text: "Starte…" });
  try {
    await ensureOffscreen();
    chrome.runtime.sendMessage({ target: "offscreen", type: "run", job });
  } catch (e) {
    finishJob(job.id, { state: "error", text: String(e.message || e) });
  }
}

function handOver(m) {
  setJob(m.id, { percent: 100, text: "Wird an Chrome übergeben…" });
  let open = m.files.length, failed = null;
  const settle = () => { if (--open > 0) return; failed ? finishJob(m.id, { state: "error", text: failed }) : finishJob(m.id, { state: "done", text: "In den Chrome-Downloads gespeichert" }); };
  for (const f of m.files) {
    chrome.downloads.download({ url: f.url, filename: f.filename, conflictAction: "uniquify", saveAs: false }, (dlId) => {
      if (chrome.runtime.lastError || dlId === undefined) { failed = "Chrome-Download fehlgeschlagen: " + (chrome.runtime.lastError?.message || ""); return settle(); }
      const onChanged = (d) => {
        if (d.id !== dlId) return;
        const s = d.state?.current;
        if (s === "complete" || s === "interrupted") {
          chrome.downloads.onChanged.removeListener(onChanged);
          if (s === "interrupted") failed = "Download unterbrochen";
          settle();
        }
      };
      chrome.downloads.onChanged.addListener(onChanged);
    });
  }
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.target === "offscreen") return;
  if (msg.target === "background") {
    if (msg.type === "progress") setJob(msg.id, { percent: msg.percent, text: msg.text });
    else if (msg.type === "ready") handOver(msg);
    else if (msg.type === "error") finishJob(msg.id, { state: "error", text: msg.message });
    return;
  }
  if (msg.type === "download") { startJob(msg.job); reply({ ok: true }); }
  else if (msg.type === "cancel") { chrome.runtime.sendMessage({ target: "offscreen", type: "cancel", id: msg.id }).catch(() => {}); reply({ ok: true }); }
});
