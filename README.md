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
5. Im Einrichtungsassistenten Instanzname, Zeitzone und Administratorkonto festlegen. Optional können elf Maker-Beispielprojekte mit installiert werden.

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
        ├── ideas/
        ├── learnings/
        └── notes/
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
- Release-Manifeste werden kryptografisch geprüft; Webupdates ersetzen ausschließlich einzeln gehashte Programmdateien.
- Docker-Updates werden vom Host ausgeführt, ohne den Docker-Socket in den Make:Log-Container einzubinden.

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

## Funktionsumfang

Der PHP-Kern, Installer, Webhosting-Einstieg, Docker-Paket sowie die zentralen Daten- und Sicherheitsabläufe sind enthalten. Projekt- und Benutzerbackups werden manuell im Browser heruntergeladen und wieder eingespielt. Automatischer E-Mail-Versand gehört nicht zum Funktionsumfang.

Der mitgelieferte Beispieldatensatz enthält vier aktive, zwei pausierte, drei abgeschlossene, ein archiviertes und ein gelöschtes Maker-Projekt sowie zwei thematische Projektordner. Administratoren können ihn unter **Einstellungen → System** jederzeit einspielen, zurücksetzen oder vollständig entfernen. Eigene Projekte und Ordner werden dabei nicht gelöscht. Ein Demo-Ordner bleibt erhalten, solange eigene Projekte oder Unterordner darin liegen; ein leerer Demo-Ordner wird entfernt. Inhalte, die nachträglich innerhalb eines Demo-Projekts angelegt wurden, gehören hingegen zu diesem Projekt und werden beim Entfernen der Beispieldaten mitgelöscht.

Sicherheitsprobleme bitte nicht öffentlich diskutieren, sondern gemäß [SECURITY.md](SECURITY.md) vertraulich melden.

Details stehen in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Updates

Administratoren sehen verfügbare Releases unter **Einstellungen → System**. Auf Webhosting kann Make:Log ein signiertes Release nach Passwortbestätigung selbst sichern und installieren. Bei Docker wird eine Update-Anforderung für den optionalen Host-Helfer angelegt; persistente Daten bleiben im Volume.

Releaseprozess, Signierschlüssel, Migrationen und Docker-Helfer sind in [docs/UPDATES.md](docs/UPDATES.md) beschrieben.
