# Make:Log mit Docker installieren

Diese Anleitung ist unabhängig vom NAS-Hersteller. Benötigt werden Docker und Docker Compose beziehungsweise die Möglichkeit, eine Compose-Datei zu importieren.

1. Den Make:Log-Ordner auf das NAS kopieren.
2. Im Ordner `.env.example` nach `.env` kopieren.
3. Optional in `.env` den Port oder die Bind-Adresse ändern. Standard ist Port `8080` auf allen lokalen Netzwerkschnittstellen. Bei einem Reverse Proxy auf demselben Host sollte `MAKELOG_BIND_ADDRESS=127.0.0.1` gesetzt werden.
4. Im Make:Log-Ordner starten:

   ```sh
   docker compose up -d --build
   ```

5. `http://<IP-DES-NAS>:8080` öffnen und den Einrichtungsassistenten abschließen.

Die persistenten Daten liegen in `makelog-data/`. Dieser Ordner muss in die NAS-Backups aufgenommen werden. Ein manuelles Update ersetzt nur den Container:

```sh
docker compose pull makelog
docker compose up -d --wait makelog
```

Für Updates direkt aus **Einstellungen → System** muss `tools/makelog-docker-updater.sh` auf dem Host regelmäßig per Cron oder NAS-Aufgabenplaner ausgeführt werden. Make:Log legt nur eine geprüfte Anforderung im Datenvolume ab; der Anwendungscontainer erhält keinen Zugriff auf den Docker-Socket. Einzelheiten stehen in [UPDATES.md](UPDATES.md).

Vor einem Update sollte zusätzlich unter **Einstellungen → Backup** ein Projekt- und Benutzerbackup heruntergeladen werden.

Für Zugriff aus dem Internet sollte das NAS Make:Log über einen Reverse Proxy mit einer eigenen Subdomain und einem gültigen HTTPS-Zertifikat veröffentlichen. Port `8080` sollte nicht direkt ins Internet weitergeleitet werden.
