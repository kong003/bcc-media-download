const $ = (id) => document.getElementById(id);
let master = null, tab = null;
let total = null; // Länge des gewählten Videos in Sekunden

const fmt = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
function parseTime(t) {
  const p = t.trim().split(":").map(Number);
  if (!p.length || p.length > 3 || p.some((n) => !isFinite(n) || n < 0)) return NaN;
  return p.reduce((a, n) => a * 60 + n, 0);
}
async function loadLength() {
  total = null; $("len").textContent = "";
  try {
    const t = await (await fetch(master.video[+$("video").value].url)).text();
    total = [...t.matchAll(/#EXTINF:([\d.]+)/g)].reduce((a, m) => a + +m[1], 0);
    $("len").textContent = "(Länge " + fmt(total) + ")";
    if (!$("tEnd").dataset.touched) $("tEnd").value = fmt(total);
  } catch {}
}
let order = []; // Indizes der gewählten Audiospuren in Ausgabe-Reihenfolge

function renderOrder() {
  $("orderBox").hidden = order.length < 2;
  $("order").innerHTML = order.map((ai, pos) => `<li><span>${master.audio[ai].name}</span>
    <button class="mv" data-p="${pos}" data-d="-1" ${pos === 0 ? "disabled" : ""}>↑</button>
    <button class="mv" data-p="${pos}" data-d="1" ${pos === order.length - 1 ? "disabled" : ""}>↓</button></li>`).join("");
  document.querySelectorAll(".mv").forEach((b) => (b.onclick = () => {
    const p = +b.dataset.p, q = p + +b.dataset.d;
    [order[p], order[q]] = [order[q], order[p]];
    renderOrder();
  }));
}

function parseAttrs(s) {
  const o = {};
  for (const m of s.matchAll(/([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g)) o[m[1]] = m[3] !== undefined ? m[3] : m[2];
  return o;
}

function parseMaster(text, base) {
  const lines = text.split("\n").map((l) => l.trim());
  const video = [], audio = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("#EXT-X-STREAM-INF:")) {
      const a = parseAttrs(l.slice(18));
      const uri = lines[i + 1];
      if (uri && !uri.startsWith("#"))
        video.push({ url: new URL(uri, base).href, bw: +a.BANDWIDTH, res: a.RESOLUTION, fps: a["FRAME-RATE"] });
    } else if (l.startsWith("#EXT-X-MEDIA:")) {
      const a = parseAttrs(l.slice(13));
      if (a.TYPE === "AUDIO" && a.URI)
        audio.push({ url: new URL(a.URI, base).href, name: a.NAME, lang: a.LANGUAGE || "und", def: a.DEFAULT === "YES" });
    }
  }
  video.sort((a, b) => b.bw - a.bw);
  return { video, audio };
}

async function findMaster(tabId) {
  const r = await chrome.storage.session.get("m3u8_" + tabId);
  const urls = (r["m3u8_" + tabId] || []).slice().reverse();
  for (const u of urls) {
    try {
      const t = await (await fetch(u)).text();
      if (t.includes("#EXT-X-STREAM-INF")) return { url: u, ...parseMaster(t, u) };
    } catch {}
  }
  return null;
}

async function pageTitle(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (document.querySelector("h1")?.innerText || document.title || "video").trim(),
    });
    return result;
  } catch { return "video"; }
}

function render() {
  $("video").innerHTML = master.video.map((v, i) =>
    `<option value="${i}">${v.res ? v.res.split("x")[1] + "p" : "?"} (${v.res || "?"}) · ${(v.bw / 1e6).toFixed(1)} Mbit/s</option>`).join("");
  order = master.audio.flatMap((a, i) => (a.def ? [i] : []));
  $("audio").innerHTML = master.audio.map((a, i) =>
    `<label><input type="checkbox" name="a" value="${i}" ${a.def ? "checked" : ""}> ${a.name}</label>`).join("");
  document.querySelectorAll("input[name=a]").forEach((c) => (c.onchange = () => {
    const i = +c.value;
    order = c.checked ? [...order, i] : order.filter((x) => x !== i);
    renderOrder();
  }));
  renderOrder();
}

$("go").onclick = async () => {
  const v = master.video[+$("video").value];
  const audios = order.map((i) => master.audio[i]);
  if (!audios.length) return alert("Bitte mindestens eine Audiospur wählen.");
  let start = null, end = null;
  if ($("range").value === "part") {
    start = parseTime($("tStart").value); end = parseTime($("tEnd").value);
    if (isNaN(start) || isNaN(end) || end <= start || (total && start >= total)) return alert("Ungültiger Zeitbereich (Start muss vor Ende liegen).");
    if (total && end >= total - 1) end = null; // bis zum Ende
  }
  const job = {
    start, duration: end === null ? null : end - start,
    totalDuration: total,
    id: Date.now().toString(),
    filename: $("fname").value.trim() || "video",
    video: v, audios,
  };
  await chrome.runtime.sendMessage({ type: "download", job });
};

async function renderJobs() {
  const { jobs = {} } = await chrome.storage.session.get("jobs");
  $("jobs").innerHTML = Object.values(jobs).reverse().map((j) => `
    <div class="job"><b>${j.name}</b>
      ${j.state === "running" ? `<button class="small" data-c="${j.id}">Abbrechen</button><progress max="100" value="${j.percent || 0}"></progress>` : ""}
      <div class="${j.state === "error" ? "error" : ""}">${j.state === "done" ? "Fertig: " : ""}${j.text || ""}</div></div>`).join("");
  document.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => chrome.runtime.sendMessage({ type: "cancel", id: b.dataset.c })));
}
chrome.storage.session.onChanged.addListener((c) => { if (c.jobs) renderJobs(); });

(async () => {
  renderJobs();
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  master = await findMaster(tab.id);
  if (!master) {
    $("status").textContent = "Kein M3U8-Stream gefunden. Video auf der Seite starten (bzw. Seite neu laden) und Popup erneut öffnen.";
    return;
  }
  $("status").hidden = true;
  $("main").hidden = false;
  $("fname").value = await pageTitle(tab.id);
  render();
  $("video").onchange = loadLength;
  $("range").onchange = () => ($("partBox").hidden = $("range").value !== "part");
  $("tEnd").oninput = () => ($("tEnd").dataset.touched = "1");
  loadLength();
})();
