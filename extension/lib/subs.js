// WebVTT-Segmente (HLS) -> SRT

const TS = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/;
const sec = (s) => { const m = TS.exec(s); return (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, "0").slice(0, 3) / 1000; };

export function parseVtt(text, cues) {
  for (const block of text.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    if (!TS.test(a) || !TS.test(b.trim().split(/\s+/)[0])) continue;
    const body = lines.slice(i + 1).join("\n")
      .replace(/<(?!\/?[ibu]>)[^>]*>/g, "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
      .trim();
    if (!body) continue;
    cues.push({ start: sec(a), end: sec(b.trim().split(/\s+/)[0]), text: body });
  }
}

const f = (t) => {
  t = Math.max(0, t);
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

// cues: Rohliste aus mehreren Segmenten (überlappende Cues kommen doppelt vor), offset: Sekunden, die vom Start abgezogen werden
export function toSrt(cues, offset = 0, bom = true) {
  const seen = new Set();
  const uniq = cues.filter((c) => { const k = c.start + "|" + c.end + "|" + c.text; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const c of uniq) {
    if (c.end - offset <= 0) continue;
    out.push(`${out.length + 1}\n${f(c.start - offset)} --> ${f(c.end - offset)}\n${c.text}\n`);
  }
  return "﻿" + out.join("\n");
}
