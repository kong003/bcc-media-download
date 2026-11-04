#!/usr/bin/env python3
"""Native-Messaging-Host: nimmt Download-Aufträge der Extension entgegen und muxt per ffmpeg."""
import http.server, json, os, re, secrets, shutil, struct, subprocess, sys, tempfile, threading

TMP_ROOT = os.path.expanduser("~/Library/Caches/BCCMediaDownloader")
temp_dirs = []
LOG = os.path.expanduser("~/Library/Application Support/BCCMediaDownloader/host.log")

def log(*a):
    try:
        with open(LOG, "a") as f:
            f.write(" ".join(str(x) for x in a) + "\n")
    except OSError:
        pass
proc = None
lock = threading.Lock()

def send(obj):
    data = json.dumps(obj).encode()
    with lock:
        sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
        sys.stdout.buffer.flush()

def read():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    return json.loads(sys.stdin.buffer.read(struct.unpack("<I", raw)[0]))

def find_ffmpeg():
    for p in [shutil.which("ffmpeg"), "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]:
        if p and os.path.exists(p):
            return p
    return None

def serve(path, filename):
    """Stellt die fertige Datei kurz auf localhost bereit, damit Chrome sie als normalen Download holt."""
    token = secrets.token_urlsafe(16)

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != f"/{token}":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Content-Length", str(os.path.getsize(path)))
            self.end_headers()
            with open(path, "rb") as f:
                shutil.copyfileobj(f, self.wfile)
        def log_message(self, *a):
            pass

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    send({"type": "ready", "url": f"http://127.0.0.1:{srv.server_address[1]}/{token}", "filename": filename})

def cleanup():
    for d in temp_dirs:
        shutil.rmtree(d, ignore_errors=True)

def hms(s):
    h, m, sec = s.split(":")
    return int(h) * 3600 + int(m) * 60 + float(sec)

def run(job):
    global proc
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        return send({"type": "error", "message": "ffmpeg nicht gefunden (brew install ffmpeg)"})
    os.makedirs(TMP_ROOT, exist_ok=True)
    tmp = tempfile.mkdtemp(dir=TMP_ROOT)
    temp_dirs.append(tmp)
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", job["filename"]).strip(" .") or "video"
    ext = "mp4"
    out = os.path.join(tmp, f"{name}.{ext}")

    cmd = [ffmpeg, "-hide_banner", "-y", "-nostdin", "-progress", "pipe:1", "-nostats"]
    inputs = [job["video"]["url"]] + [a["url"] for a in job["audios"]]
    start = job.get("start")
    for u in inputs:
        cmd += ["-allowed_extensions", "ALL", "-extension_picky", "0"]
        if start:
            cmd += ["-ss", str(start)]
        cmd += ["-i", u]
    cmd += ["-map", "0:v:0"]
    for i in range(len(job["audios"])):
        cmd += ["-map", f"{i + 1}:a:0"]
    cmd += ["-c", "copy"]
    for i, a in enumerate(job["audios"]):
        cmd += [f"-metadata:s:a:{i}", f"language={a['lang']}", f"-metadata:s:a:{i}", f"handler_name={a['name']}",
                f"-disposition:a:{i}", "default" if i == 0 else "0"]
    if job.get("duration"):
        cmd += ["-t", str(job["duration"])]
    cmd += ["-movflags", "+faststart"]
    cmd += [out]

    log("ffmpeg:", " ".join(c.split("?")[0] if c.startswith("http") else c for c in cmd))
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    state = {"dur": job.get("duration"), "err": []}
    if not state["dur"] and start and job.get("totalDuration"):
        state["dur"] = max(1, job["totalDuration"] - start)

    def watch_err():
        for line in proc.stderr:
            state["err"].append(line)
            state["err"] = state["err"][-15:]
            m = re.search(r"Duration: (\d+:\d+:[\d.]+)", line)
            if m and state["dur"] is None:
                state["dur"] = hms(m.group(1))
    threading.Thread(target=watch_err, daemon=True).start()

    for line in proc.stdout:
        m = re.match(r"out_time_us=(\d+)", line.strip())
        if m:
            t = int(m.group(1)) / 1e6
            if state["dur"]:
                pct = min(99, t / state["dur"] * 100)
                send({"type": "progress", "percent": round(pct, 1), "text": f"{pct:.0f} % ({int(t // 60)}:{int(t % 60):02d} / {int(state['dur'] // 60)}:{int(state['dur'] % 60):02d})"})
            else:
                send({"type": "progress", "percent": 0, "text": f"{int(t)} s geladen"})
    code = proc.wait()
    if code == 0:
        serve(out, f"{name}.{ext}")
    else:
        shutil.rmtree(tmp, ignore_errors=True)
        log("ffmpeg exit", code, "".join(state["err"]))
        send({"type": "error", "message": "ffmpeg-Fehler: " + "".join(state["err"])[-400:] if code > 0 else "Abgebrochen"})

def main():
    log("host gestartet")
    while True:
        msg = read()
        if msg is None:
            if proc and proc.poll() is None:
                proc.kill()
            cleanup()
            return
        if msg["type"] == "start":
            threading.Thread(target=run, args=(msg,), daemon=True).start()
        elif msg["type"] == "cancel" and proc and proc.poll() is None:
            proc.kill()

if __name__ == "__main__":
    main()
