# Das Logbuch mit Docker installieren

Diese Anleitung ist unabhängig vom NAS-Hersteller. Benötigt werden Docker und Docker Compose beziehungsweise die Möglichkeit, eine Compose-Datei zu importieren.

1. Den Logbuch-Ordner auf das NAS kopieren.
2. Im Ordner `.env.example` nach `.env` kopieren.
3. Optional in `.env` den Port oder die Bind-Adresse ändern. Standard ist Port `8080` auf allen lokalen Netzwerkschnittstellen. Bei einem Reverse Proxy auf demselben Host sollte `LOGBUCH_BIND_ADDRESS=127.0.0.1` gesetzt werden.
4. Im Logbuch-Ordner starten:

   ```sh
   docker compose up -d
   ```

5. `http://<IP-DES-NAS>:8080` öffnen und den Einrichtungsassistenten abschließen.

Das ist die gesamte Ersteinrichtung. Compose legt automatisch zwei Container an:

- `logbuch` stellt ausschließlich die Webanwendung bereit und besitzt keinen Docker-Socket.
- `logbuch-updater` läuft ohne eigenen Port im Hintergrund und verarbeitet bestätigte Updates.

Beide verwenden das benannte Volume `logbuch-data`. Darin liegen Datenbank, Projekte, Anhänge und Updatezustand. Dieses Volume muss in die NAS-Backups aufgenommen werden. `docker compose down` oder ein neu gebauter Container löschen es nicht; nur `docker compose down --volumes` würde es ausdrücklich entfernen.

## Updates

Administratoren wählen unter **Einstellungen → System** die neue Version und bestätigen mit ihrem Passwort. Der AIO-Updater prüft das signierte Manifest nochmals unabhängig, lädt App und Updater anhand fester SHA-256-Digests, startet die Anwendung neu und wartet auf den Healthcheck. Schlägt dieser fehl, wird automatisch die vorherige App-Version wiederhergestellt.

SSH, Cron, ein Aufgabenplaner und ein manuell installiertes Hilfsskript sind dafür nicht nötig. Während des Neustarts kann die Seite kurz nicht erreichbar sein. Weitere Einzelheiten stehen in [UPDATES.md](UPDATES.md).

Vor einem Update sollte zusätzlich unter **Einstellungen → Backup** ein Projekt- und Benutzerbackup heruntergeladen werden.

Für Zugriff aus dem Internet sollte das NAS das Logbuch über einen Reverse Proxy mit einer eigenen Subdomain und einem gültigen HTTPS-Zertifikat veröffentlichen. Port `8080` sollte nicht direkt ins Internet weitergeleitet werden.
