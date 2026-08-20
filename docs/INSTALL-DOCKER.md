# Make:Log mit Docker installieren

Diese Anleitung ist unabhängig vom NAS-Hersteller. Benötigt werden Docker und Docker Compose beziehungsweise die Möglichkeit, eine Compose-Datei zu importieren.

1. Den Make:Log-Ordner auf das NAS kopieren.
2. Im Ordner `.env.example` nach `.env` kopieren.
3. Optional in `.env` den Port ändern. Standard ist `8080`.
4. Im Make:Log-Ordner starten:

   ```sh
   docker compose up -d --build
   ```

5. `http://<IP-DES-NAS>:8080` öffnen und den Einrichtungsassistenten abschließen.

Die persistenten Daten liegen in `makelog-data/`. Dieser Ordner muss in die NAS-Backups aufgenommen werden. Ein Update ersetzt nur den Container:

```sh
docker compose up -d --build
```

Vor einem Update sollte zusätzlich unter **Einstellungen → Backup** ein Projekt- und Benutzerbackup heruntergeladen werden.

Für Zugriff aus dem Internet sollte das NAS Make:Log über einen Reverse Proxy mit einer eigenen Subdomain und einem gültigen HTTPS-Zertifikat veröffentlichen. Port `8080` sollte nicht direkt ins Internet weitergeleitet werden.

