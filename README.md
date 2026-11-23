# Umfrage Dirigententagung

Anonyme Kurzumfrage (7 Fragen + 2 optionale), mobil, < 3 Min.
Läuft auf dem Netcup-VPS hinter dem bestehenden Traefik (Netz `proxy`, Entrypoint `websecure`, Certresolver `le`).

- Umfrage: https://dirigenten.cloud-eck.de
- Ergebnisse: https://dirigenten.cloud-eck.de/ergebnisse (Passwort per `RESULTS_PASSWORD`, Standard `Tagung2026!`)

## Anonymität
Gespeichert werden nur die Antworten in `data/antworten.json`: keine IP, keine Uhrzeit, keine Cookies.
Neue Antworten werden an zufälliger Stelle eingefügt, damit die Reihenfolge nichts über die Abgabezeit verrät.
Ein `localStorage`-Flag im Browser verhindert nur versehentliches Doppelt-Absenden.
Hinweis: Falls Traefik Access-Logs schreibt, stehen dort IPs mit Uhrzeit (nicht mit Antworten verknüpfbar, aber ggf. für diesen Router abschalten).

## Deploy auf dem VPS
1. DNS: A-Record `dirigenten.cloud-eck.de` → `62.83.38.193`
2. Auf dem VPS:
   ```bash
   cd /opt/stack && git clone -b claude/fervent-clarke-1438ip https://github.com/eckstaedt/umfrage.git umfrage
   cd umfrage && mkdir -p data && chown 1000:1000 data
   docker compose up -d --build
   ```
3. Test: `curl -s https://dirigenten.cloud-eck.de/health`

Andere Subdomain: `UMFRAGE_HOST=... docker compose up -d` (oder in `.env`).
Zurücksetzen nach Testantworten: `docker compose down && rm data/antworten.json && docker compose up -d`.
