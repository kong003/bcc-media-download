# BCC Media Downloader

Chrome-Erweiterung für app.bcc.media: Qualität wählen, mehrere Audiospuren (mit Reihenfolge), ganzes Video oder Ausschnitt – das Ergebnis erscheint als normale MP4 in den Chrome-Downloads. Keine weitere Software nötig (ffmpeg ist als WebAssembly enthalten).

## Installation (einmalig, ca. 1 Minute)
1. Zip entpacken (der Ordner `extension` muss dauerhaft an einem festen Ort bleiben).
2. In Chrome `chrome://extensions` öffnen und oben rechts **Entwicklermodus** einschalten.
3. **Entpackte Erweiterung laden** klicken und den Ordner `extension` wählen.
4. Optional: Puzzle-Symbol in der Chrome-Leiste → Erweiterung anpinnen.

## Benutzung
1. Auf app.bcc.media ein Video öffnen und kurz abspielen (bzw. Seite neu laden, Video starten).
2. Auf das Erweiterungs-Symbol klicken, Auflösung/Audiospuren/Umfang wählen, **Herunterladen**.
3. Fertig – die Datei steht in den Chrome-Downloads. Das Popup darf geschlossen werden.

## Hinweise
- Gedacht für Videos bis ca. 15–20 Minuten; die Datei muss komplett in den Browserspeicher passen (Popup warnt ab ca. 1,1 GB).
- Mehrere Audiospuren in einer MP4 spielen VLC/IINA ab; QuickTime und Browser spielen meist nur die Standardspur.
- Ausschnitte werden verlustfrei an Segmentgrenzen (ca. ±6 s) geschnitten.
