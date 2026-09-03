# Logbuch

Das Logbuch hält Fortschritte, anstehende und erledigte Arbeitsschritte, Materialien, Kontakte, Links und Ideen zu DIY-Projekten fest. Ein eigener persönlicher Erinnerungsbereich nimmt kurze Notizen ohne Projektbezug auf; diese lassen sich per Drag-and-drop sortieren, eine Ebene tief gruppieren und in frei wählbaren Tages-, Wochen-, Monats- oder Jahresabständen wiederholen. Die responsive Weboberfläche läuft mit einem gemeinsamen PHP-Kern sowohl auf normalem Webhosting als auch in einem Docker-Container.

Die Änderungen aller veröffentlichten Versionen stehen im [Changelog](CHANGELOG.md).

Projekte bleiben als Markdown- und JSON-Dateien lesbar. SQLite speichert Benutzer, persönliche Erinnerungen, Sitzungen, Rollen, Freigaben, Tags, Einstellungen und das Änderungsprotokoll.

## Voraussetzungen

- PHP 8.2 oder neuer
- PHP-Erweiterungen `pdo_sqlite`, `json`, `mbstring` und `openssl`
- Apache mit `.htaccess` oder ein anderer Webserver, der Anfragen an `public/index.php` weiterleitet
- Schreibzugriff auf `storage/`

Das Logbuch benötigt weder MySQL noch Node.js, einen externen Dienst oder eine Cloud-Datenbank.

## Installation auf Webhosting

Die Installation ist für klassisches Shared Hosting ausgelegt:

1. Alle Dateien in einen Ordner auf dem Webspace hochladen, beispielsweise `logbuch/`.
2. Die Subdomain im Hosting-Menü so einstellen, dass ihr Dokumentenstamm auf `logbuch/public/` zeigt.
3. Sicherstellen, dass PHP 8.2 oder neuer gewählt ist und `storage/` für PHP beschreibbar ist.
4. Die Subdomain per HTTPS öffnen.
5. Im Einrichtungsassistenten Instanzname, Zeitzone und Administratorkonto festlegen. Optional können elf Maker-Beispielprojekte mit installiert werden.

Die Datenbank und alle benötigten Ordner werden automatisch angelegt. Der Ordner `storage/` liegt bewusst außerhalb des öffentlichen Dokumentenstamms.

Eine ausführliche Anleitung steht in [docs/INSTALL-WEBHOSTING.md](docs/INSTALL-WEBHOSTING.md).

## Installation mit Docker

Voraussetzung ist Docker mit Docker Compose.

```sh
cp .env.example .env
docker compose up -d
```

Compose legt automatisch die beiden Container `logbuch` und `logbuch-updater` an. In der Oberfläche ist davon nichts weiter zu sehen. Danach das Logbuch unter `http://<NAS-IP>:8080` öffnen und den Einrichtungsassistenten abschließen. Port und Zeitzone können in `.env` angepasst werden. Alle dauerhaften Daten liegen im Docker-Volume `logbuch-data`; neue Container löschen sie daher nicht.

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
        ├── shopping/
        ├── materials/
        ├── contacts/
        ├── links/
        ├── ideas/
        ├── learnings/
        └── notes/
```

IDs werden beim Umbenennen nicht geändert. Projekt- und Eintragslinks bleiben dadurch stabil. Links in der Oberfläche verwenden relative Pfade; bei einem Serverumzug muss daher nur die Domain beziehungsweise Subdomain weiter auf das Logbuch zeigen.

## Sicherheit

- Passwörter werden mit Argon2id gehasht.
- Sitzungen liegen serverseitig in SQLite; Browser erhalten nur ein `HttpOnly`-/`SameSite=Strict`-Cookie.
- Schreibzugriffe sind mit CSRF-Token geschützt.
- Fehlgeschlagene Anmeldungen werden dauerhaft und IP-bezogen gedrosselt.
- Rollen und Projektfreigaben werden bei jedem API-Aufruf serverseitig geprüft.
- Sicherheitsheader sperren fremde Frames, externe Skripte und unnötige Browserberechtigungen.
- Daten werden atomar über temporäre Dateien geschrieben.
- Release-Manifeste werden kryptografisch geprüft; Webupdates ersetzen ausschließlich einzeln gehashte Programmdateien.
- Docker-Updates werden vom getrennten AIO-Updater ausgeführt. Nur dieser Hilfscontainer erhält den Docker-Socket; der Logbuch-Container selbst nicht.

Für öffentlich erreichbare Installationen ist HTTPS verpflichtend. PHP, das Docker-Image und das Logbuch müssen regelmäßig aktualisiert werden. Projekt- und Benutzerbackups sollten außerhalb des Servers aufbewahrt werden.

## Entwicklung und Tests

Lokale Docker-Images bauen und starten:

```sh
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

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

Persönliche Erinnerungen sind bewusst unabhängig von Projekten. Sobald etwas Projektbezug hat, wird es stattdessen als anstehender oder erledigter Arbeitsschritt im jeweiligen Logbuch geführt. Eine Erinnerung lässt sich über das Projektsymbol in ein aktives Projekt umwandeln; untergeordnete Erinnerungen werden dabei als anstehende Einträge übernommen. Das Projektsymbol folgt der persönlichen Einstellung für das Standard-Projektsymbol. Erinnerungen besitzen weder Projektzuordnung noch Tags, Prioritäten, frei vergebene Fälligkeiten oder Anhänge und erzeugen beim Abhaken keinen Logbucheintrag. Für wiederkehrende Erinnerungen lässt sich ein Abstand in Tagen, Wochen, Monaten oder Jahren festlegen. Beim Abhaken startet der Zeitraum neu, die Erinnerung bleibt aber zunächst unter **Offen**. Erst **Aufräumen** verschiebt sie in **Erledigt**; nach Ablauf des Zeitraums wird sie automatisch wieder geöffnet. Ist der Zeitraum schon vor dem Aufräumen abgelaufen, öffnet sie sich direkt wieder. Wiederkehrende Erinnerungen sind vor **Erledigte löschen** geschützt und können nur einzeln oder nach dem Entfernen ihrer Wiederholung gelöscht werden. Über **Aufräumen** wechseln nur erledigte Erinnerungen auf der Hauptebene ohne offene Kinder samt ihrer verschachtelten Erinnerungen in den Erledigt-Bereich. Sie werden einschließlich ihrer Wiederholungsangaben im Benutzerbackup, nicht im Projektbackup, gespeichert.

Der mitgelieferte Beispieldatensatz enthält vier aktive, zwei pausierte, drei abgeschlossene, ein archiviertes und ein gelöschtes Maker-Projekt sowie zwei thematische Projektordner. Hinzu kommen 15 verschachtelte Lagerorte, 13 Artikel, verteilte Bestände, Anfangsbuchungen, lokale Mindestbestände und drei aktive Projektreservierungen. Administratoren können alles unter **Einstellungen → System** jederzeit einspielen, zurücksetzen oder entfernen. Eigene Projekte, Artikel und Lagerorte werden dabei nicht gelöscht. Demo-Ordner und Demo-Lagerorte bleiben erhalten, solange eigene Inhalte von ihnen abhängen.

Sicherheitsprobleme bitte nicht öffentlich diskutieren, sondern gemäß [SECURITY.md](SECURITY.md) vertraulich melden.

Details stehen in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Updates

Administratoren sehen verfügbare Releases unter **Einstellungen → System**. Auf Webhosting kann das Logbuch ein signiertes Release nach Passwortbestätigung selbst sichern und installieren. Bei Docker übernimmt der automatisch mitgestartete AIO-Updater Download, Healthcheck und bei Bedarf die Wiederherstellung der vorherigen Version; persistente Daten bleiben im Volume.

Releaseprozess, Signierschlüssel, Migrationen und AIO-Updater sind in [docs/UPDATES.md](docs/UPDATES.md) beschrieben.
