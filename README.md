# Make:Log – Projekttagebuch für Maker

Make:Log hält Fortschritte, anstehende und erledigte Arbeitsschritte, Materialien, Kontakte, Links und Ideen zu DIY-Projekten fest. Die responsive Weboberfläche läuft mit einem gemeinsamen PHP-Kern sowohl auf normalem Webhosting als auch in einem Docker-Container.

Projekte bleiben als Markdown- und JSON-Dateien lesbar. SQLite speichert Benutzer, Sitzungen, Rollen, Freigaben, Tags, Einstellungen und das Änderungsprotokoll.

## Voraussetzungen

- PHP 8.2 oder neuer
- PHP-Erweiterungen `pdo_sqlite`, `json`, `mbstring` und `openssl`
- Apache mit `.htaccess` oder ein anderer Webserver, der Anfragen an `public/index.php` weiterleitet
- Schreibzugriff auf `storage/`

Make:Log benötigt weder MySQL noch Node.js, einen externen Dienst oder eine Cloud-Datenbank.

## Installation auf Webhosting

Die Installation ist für klassisches Shared Hosting ausgelegt:

1. Alle Dateien in einen Ordner auf dem Webspace hochladen, beispielsweise `makelog/`.
2. Die Subdomain im Hosting-Menü so einstellen, dass ihr Dokumentenstamm auf `makelog/public/` zeigt.
3. Sicherstellen, dass PHP 8.2 oder neuer gewählt ist und `storage/` für PHP beschreibbar ist.
4. Die Subdomain per HTTPS öffnen.
5. Im Einrichtungsassistenten Instanzname, Zeitzone und Administratorkonto festlegen.

Die Datenbank und alle benötigten Ordner werden automatisch angelegt. Der Ordner `storage/` liegt bewusst außerhalb des öffentlichen Dokumentenstamms.

Eine ausführliche Anleitung steht in [docs/INSTALL-WEBHOSTING.md](docs/INSTALL-WEBHOSTING.md).

## Installation mit Docker

Voraussetzung ist Docker mit Docker Compose.

```sh
cp .env.example .env
docker compose up -d --build
```

Danach Make:Log unter `http://<NAS-IP>:8080` öffnen und den Einrichtungsassistenten abschließen. Port und Zeitzone können in `.env` angepasst werden. Alle dauerhaften Daten liegen auf dem Host in `makelog-data/`; ein neu gebauter Container löscht sie daher nicht.

Eine ausführliche NAS-unabhängige Anleitung steht in [docs/INSTALL-DOCKER.md](docs/INSTALL-DOCKER.md).

## Speicherstruktur

```text
storage/
├── database.sqlite
└── projects/
    └── {projekt-id}/
        ├── README.md
        ├── project.json
        ├── entries/
        ├── tasks/
        ├── materials/
        ├── contacts/
        ├── links/
        └── ideas/
```

IDs werden beim Umbenennen nicht geändert. Projekt- und Eintragslinks bleiben dadurch stabil. Links in der Oberfläche verwenden relative Pfade; bei einem Serverumzug muss daher nur die Domain beziehungsweise Subdomain weiter auf Make:Log zeigen.

## Sicherheit

- Passwörter werden mit Argon2id gehasht.
- Sitzungen liegen serverseitig in SQLite; Browser erhalten nur ein `HttpOnly`-/`SameSite=Strict`-Cookie.
- Schreibzugriffe sind mit CSRF-Token geschützt.
- Fehlgeschlagene Anmeldungen werden dauerhaft und IP-bezogen gedrosselt.
- Rollen und Projektfreigaben werden bei jedem API-Aufruf serverseitig geprüft.
- Sicherheitsheader sperren fremde Frames, externe Skripte und unnötige Browserberechtigungen.
- Daten werden atomar über temporäre Dateien geschrieben.

Für öffentlich erreichbare Installationen ist HTTPS verpflichtend. PHP, Docker-Image und Make:Log müssen regelmäßig aktualisiert werden. Projekt- und Benutzerbackups sollten außerhalb des Servers aufbewahrt werden.

## Entwicklung und Tests

Lokalen PHP-Server starten:

```sh
php -S 127.0.0.1:8080 -t public public/router.php
```

Automatisierte Server- und Sicherheitstests:

```sh
npm test
```

Die Tests verwenden einen temporären Datenspeicher und prüfen Installer, Sitzungsschutz, CSRF, Projekt- und Logabläufe, Markdown-Dateien, Papierkorb und Änderungsprotokoll.

## Stand der Migration

Der neue PHP-Kern, Installer, Webhosting-Einstieg, Docker-Paket und die zentralen Daten- und Sicherheitsabläufe sind vorhanden. Der reale SMTP-Versand und zeitgesteuerte Backup-Job sind noch nicht angeschlossen; die Oberfläche kennzeichnet diese Funktionen weiterhin als noch nicht ausführbar.

Die frühere ESP32-Implementierung bleibt während der Migration als Referenz in `src/`, `include/` und `platformio.ini` erhalten. Sie gehört nicht mehr zur Zielplattform und wird entfernt, sobald alle noch relevanten Alt-Funktionen im neuen Kern abgedeckt sind.

Details stehen in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

