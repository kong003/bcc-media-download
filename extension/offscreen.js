import { runJob } from "./lib/runner.js";

const jobs = new Map(); // id -> { ctrl, urls }
const send = (m) => chrome.runtime.sendMessage({ target: "background", ...m });

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "run") run(msg.job);
  else if (msg.type === "cancel") jobs.get(msg.id)?.ctrl.abort();
  else if (msg.type === "release") { const j = jobs.get(msg.id); j?.urls?.forEach((u) => URL.revokeObjectURL(u)); jobs.delete(msg.id); }
});

async function run(job) {
  const ctrl = new AbortController();
  jobs.set(job.id, { ctrl });
  try {
    const files = await runJob(job, {
      coreURL: chrome.runtime.getURL("lib/ffmpeg/ffmpeg-core.js"),
      wasmURL: chrome.runtime.getURL("lib/ffmpeg/ffmpeg-core.wasm"),
      signal: ctrl.signal,
      onProgress: (percent, text) => send({ type: "progress", id: job.id, percent, text }),
    });
    const out = files.map((f) => ({ filename: f.filename, url: URL.createObjectURL(f.blob) }));
    jobs.get(job.id).urls = out.map((f) => f.url);
    send({ type: "ready", id: job.id, files: out });
  } catch (e) {
    jobs.delete(job.id);
    send({ type: "error", id: job.id, message: ctrl.signal.aborted ? "Abgebrochen" : String(e.message || e) });
  }
}
