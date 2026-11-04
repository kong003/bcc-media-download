#!/bin/bash
# Registriert den Native-Messaging-Host für Chrome (macOS).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
ID="$(cat "$DIR/native/extension_id.txt")"
# Chrome darf Skripte in ~/Documents (macOS-Datenschutz) nicht ausführen -> Host nach Application Support kopieren
DEST="$HOME/Library/Application Support/BCCMediaDownloader"
mkdir -p "$DEST"
cp "$DIR/native/host.py" "$DEST/host.py"
chmod +x "$DEST/host.py"
for BROWSER in "Google/Chrome" "Chromium" "BraveSoftware/Brave-Browser" "Microsoft Edge"; do
  T="$HOME/Library/Application Support/$BROWSER/NativeMessagingHosts"
  [ -d "$HOME/Library/Application Support/$BROWSER" ] || continue
  mkdir -p "$T"
  cat > "$T/com.bccdl.host.json" <<JSON
{
  "name": "com.bccdl.host",
  "description": "BCC Media Downloader (ffmpeg)",
  "path": "$DEST/host.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ID/"]
}
JSON
  echo "Host registriert für $BROWSER"
done
command -v ffmpeg >/dev/null || echo "WARNUNG: ffmpeg fehlt (brew install ffmpeg)"
echo "Fertig. Jetzt Extension in chrome://extensions laden (Entwicklermodus → 'Entpackte Erweiterung laden' → Ordner 'extension')."
