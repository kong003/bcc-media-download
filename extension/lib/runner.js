// Lädt Segmente, fügt sie zusammen und muxt per ffmpeg.wasm zu einer MP4 (ohne Neukodierung).
import { FFmpeg } from "./ffmpeg/index.js";
import { parseMedia, selectSegments } from "./hls.js";
import { parseVtt, toSrt } from "./subs.js";

const POOL = 6;

async function fetchRetry(url, signal, as = "arrayBuffer") {
  let err;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r[as === "text" ? "text" : "arrayBuffer"]();
    } catch (e) {
      if (signal.aborted) throw e;
      err = e;
      await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
  }
  throw err;
}

// Führt fn für alle Elemente mit begrenzter Parallelität aus.
async function pool(items, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(POOL, items.length) }, worker));
}

/**
 * job: { video:{url}, audios:[{url,lang,name}], subs:[{url,lang,name}], noVideo, keepSrt, filename, start, duration }  (start/duration in Sekunden oder null)
 * job.subMode: "embed" (Spur in der MP4, Standard) | "srt" (nur Datei)
 * opts: { coreURL, wasmURL, signal, onProgress(percent, text) }
 * -> [{ filename, blob }]  (MP4 und/oder SRT-Dateien)
 */
export async function runJob(job, { coreURL, wasmURL, signal, onProgress }) {
  const wantVideo = !job.noVideo;
  const subs = job.subs || [];
  const mode = job.subMode || "embed";
  const embed = wantVideo && mode === "embed" && subs.length > 0;
  const tracks = [{ url: job.video.url, file: "v.mp4" }, ...(wantVideo ? job.audios.map((a, i) => ({ url: a.url, file: `a${i}.mp4` })) : [])];
  const end = job.duration != null ? (job.start || 0) + job.duration : null;

  onProgress(0, "Lade Playlists…");
  for (const t of tracks) {
    const m = parseMedia(await fetchRetry(t.url, signal, "text"), t.url);
    t.init = m.init;
    t.segs = selectSegments(m.segs, job.start, end);
    if (!t.segs.length) throw new Error("Keine Segmente im gewählten Bereich");
  }
  for (const s of subs) {
    const m = parseMedia(await fetchRetry(s.url, signal, "text"), s.url);
    s.segs = selectSegments(m.segs, job.start, end);
  }
  const offset = tracks[0].segs[0].start; // Das Video beginnt an der ersten gewählten Segmentgrenze
  const activeTracks = wantVideo ? tracks : [];
  const totalSegs = activeTracks.reduce((a, t) => a + t.segs.length, 0) + subs.reduce((a, s) => a + s.segs.length, 0);
  let done = 0;
  const tick = () => { done++; onProgress(Math.min(90, (done / totalSegs) * 90), `Lade Segmente ${done}/${totalSegs}`); };
  const files = [];

  // Untertitel
  for (const s of subs) {
    const cues = [];
    const texts = new Array(s.segs.length);
    await pool(s.segs, async (seg, i) => { texts[i] = await fetchRetry(seg.url, signal, "text"); tick(); });
    texts.forEach((t) => parseVtt(t, cues));
    s.srt = toSrt(cues, offset, false);
    // Als eigene Datei: bei reinem Untertitel-Download oder auf Wunsch zusätzlich zur Einbettung
    if (!wantVideo || mode === "srt" || job.keepSrt)
      files.push({ filename: `${job.filename}.${s.lang}.srt`, blob: new Blob(["\ufeff" + s.srt], { type: "application/x-subrip" }) });
  }
  if (!wantVideo) return files;

  const ff = new FFmpeg();
  const logs = [];
  ff.on("log", ({ message }) => { logs.push(message); if (logs.length > 20) logs.shift(); });
  signal.addEventListener("abort", () => ff.terminate());
  onProgress(Math.min(90, (done / totalSegs) * 90), "Starte ffmpeg…");
  await ff.load({ coreURL, wasmURL });

  for (const t of tracks) {
    const parts = new Array(t.segs.length + (t.init ? 1 : 0));
    const list = [...(t.init ? [{ url: t.init, i: 0 }] : []), ...t.segs.map((s, i) => ({ url: s.url, i: i + (t.init ? 1 : 0) }))];
    await pool(list, async (it) => {
      parts[it.i] = new Uint8Array(await fetchRetry(it.url, signal));
      if (it.url !== t.init) tick();
    });
    const size = parts.reduce((a, p) => a + p.length, 0);
    const buf = new Uint8Array(size);
    let off = 0;
    for (let i = 0; i < parts.length; i++) { buf.set(parts[i], off); off += parts[i].length; parts[i] = null; }
    await ff.writeFile(t.file, buf);
  }

  onProgress(92, "Füge Spuren zusammen…");
  const args = [];
  for (const t of tracks) args.push("-i", t.file);
  if (embed) for (let i = 0; i < subs.length; i++) {
    await ff.writeFile(`s${i}.srt`, new TextEncoder().encode(subs[i].srt));
    args.push("-i", `s${i}.srt`);
  }
  args.push("-map", "0:v:0");
  job.audios.forEach((_, i) => args.push("-map", `${i + 1}:a:0`));
  if (embed) subs.forEach((_, i) => args.push("-map", `${tracks.length + i}:0`));
  args.push("-c", "copy");
  if (embed) {
    args.push("-c:s", "mov_text");
    subs.forEach((s, i) => args.push(`-metadata:s:s:${i}`, `language=${s.lang}`, `-metadata:s:s:${i}`, `handler_name=${s.name}`));
    args.push("-disposition:s", "0");
  }
  job.audios.forEach((a, i) => args.push(`-metadata:s:a:${i}`, `language=${a.lang}`, `-metadata:s:a:${i}`, `handler_name=${a.name}`,
    `-disposition:a:${i}`, i === 0 ? "default" : "0"));
  args.push("-avoid_negative_ts", "make_zero", "-y", "out.mp4");
  const code = await ff.exec(args);
  if (code !== 0) throw new Error("ffmpeg-Fehler: " + logs.join(" ").slice(-300));

  const data = await ff.readFile("out.mp4");
  ff.terminate();
  return [{ filename: `${job.filename}.mp4`, blob: new Blob([data], { type: "video/mp4" }) }, ...files];
}
