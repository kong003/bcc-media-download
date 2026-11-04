const HOST = "com.bccdl.host";
const ports = new Map(); // jobId -> native port

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

// ---- downloads via native host ------------------------------------------
async function setJob(id, patch) {
  const r = await session.get("jobs");
  const jobs = r.jobs || {};
  jobs[id] = { ...(jobs[id] || {}), ...patch };
  await session.set({ jobs });
}

// Fertige Datei als normalen Chrome-Download holen; der Host räumt danach auf (Port schließen).
function handOver(job, port, m) {
  setJob(job.id, { percent: 100, text: "Wird an Chrome übergeben…" });
  const finish = (patch) => { setJob(job.id, patch); ports.delete(job.id); port.disconnect(); };
  chrome.downloads.download({ url: m.url, filename: m.filename, conflictAction: "uniquify", saveAs: false }, (dlId) => {
    if (chrome.runtime.lastError || dlId === undefined)
      return finish({ state: "error", text: "Chrome-Download fehlgeschlagen: " + (chrome.runtime.lastError?.message || "") });
    const onChanged = (d) => {
      if (d.id !== dlId) return;
      if (d.state?.current === "complete") { chrome.downloads.onChanged.removeListener(onChanged); finish({ state: "done", text: "In den Chrome-Downloads gespeichert" }); }
      else if (d.state?.current === "interrupted") { chrome.downloads.onChanged.removeListener(onChanged); finish({ state: "error", text: "Download unterbrochen" }); }
    };
    chrome.downloads.onChanged.addListener(onChanged);
  });
}

function startJob(job) {
  const port = chrome.runtime.connectNative(HOST);
  ports.set(job.id, port);
  setJob(job.id, { id: job.id, name: job.filename, state: "running", percent: 0, text: "Starte…" });
  port.onMessage.addListener((m) => {
    if (m.type === "progress") setJob(job.id, { percent: m.percent, text: m.text });
    else if (m.type === "ready") handOver(job, port, m);
    else if (m.type === "error") { setJob(job.id, { state: "error", text: m.message }); port.disconnect(); ports.delete(job.id); }
  });
  port.onDisconnect.addListener(() => {
    if (!ports.has(job.id)) return;
    ports.delete(job.id);
    const err = chrome.runtime.lastError?.message || "Verbindung zum Hilfsprogramm getrennt";
    setJob(job.id, { state: "error", text: err + " (install.sh ausgeführt?)" });
  });
  port.postMessage({ type: "start", ...job });
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.type === "download") { startJob(msg.job); reply({ ok: true }); }
  else if (msg.type === "cancel") {
    const p = ports.get(msg.id);
    if (p) { p.postMessage({ type: "cancel" }); }
    reply({ ok: true });
  }
});
