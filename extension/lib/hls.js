// Parser für HLS-Playlists (Master + Media) und Auswahl der benötigten Segmente.

function parseAttrs(s) {
  const o = {};
  for (const m of s.matchAll(/([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g)) o[m[1]] = m[3] !== undefined ? m[3] : m[2];
  return o;
}

export function parseMaster(text, base) {
  const lines = text.split("\n").map((l) => l.trim());
  const video = [], audio = [], subs = [];
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
      else if (a.TYPE === "SUBTITLES" && a.URI)
        subs.push({ url: new URL(a.URI, base).href, name: a.NAME, lang: a.LANGUAGE || "und" });
    }
  }
  video.sort((a, b) => b.bw - a.bw);
  return { video, audio, subs };
}

// -> { init: url|null, segs: [{url, dur, start}], total }
export function parseMedia(text, base) {
  let init = null, dur = null, t = 0;
  const segs = [];
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (l.startsWith("#EXT-X-KEY") && !/METHOD=NONE/.test(l)) throw new Error("Stream ist verschlüsselt – wird nicht unterstützt");
    if (l.startsWith("#EXT-X-MAP:")) init = new URL(parseAttrs(l.slice(11)).URI, base).href;
    else if (l.startsWith("#EXTINF:")) dur = parseFloat(l.slice(8));
    else if (l && !l.startsWith("#") && dur !== null) {
      segs.push({ url: new URL(l, base).href, dur, start: t });
      t += dur; dur = null;
    }
  }
  return { init, segs, total: t };
}

// Segmente, die [start, end) überlappen (end = null: bis zum Ende).
export function selectSegments(segs, start, end) {
  if (start == null && end == null) return segs;
  const s = start || 0, e = end == null ? Infinity : end;
  // Toleranz: Audio- und Videosegmente enden oft um Bruchteile einer Sekunde versetzt; ein Segment, das nur
  // hauchdünn in den Bereich ragt, soll nicht mitgeladen werden (sonst starten die Spuren versetzt).
  const eps = 0.25;
  return segs.filter((x) => x.start + x.dur > s + eps && x.start < e - eps);
}
