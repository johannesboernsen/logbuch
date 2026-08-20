# Zielarchitektur

## Ein Kern, zwei Installationsarten

Make:Log ist eine PHP-Anwendung. Docker enthält denselben PHP-Code und ist nur eine alternative Verpackung. Dadurch entstehen keine getrennten Docker- und Webhosting-Versionen.

```text
Browser
  │ HTTPS + /api/* + stabile /p/{id}-Links
  ▼
public/index.php
  │
  ├── Anmeldung, Sitzung, CSRF und Rechte
  ├── Projekte, Arbeitsschritte und Sammlungen
  ├── Benutzer, Tags, Einstellungen und Protokoll
  └── Backup- und später Mail-Dienste
       │
       ├── Markdown + JSON in storage/projects/
       └── SQLite in storage/database.sqlite
```

Der öffentliche Webserver zeigt ausschließlich auf `public/`. Anwendungscode und Daten liegen außerhalb dieses Dokumentenstamms. Docker setzt dieselbe Trennung über seine Apache-Konfiguration um.

## Offene Projektdaten

Jeder fachliche Datensatz besitzt eine JSON-Datei und eine Markdown-Datei mit YAML-Frontmatter. JSON ermöglicht eine verlustfreie Wiederherstellung und schnelle Verarbeitung; Markdown bleibt ohne Make:Log lesbar. Schreibvorgänge verwenden eine temporäre Datei und ein anschließendes atomisches Umbenennen.

SQLite ist für transaktionale Daten vorgesehen: Benutzer, Argon2id-Hashes, Sitzungen, Anmeldebegrenzung, Projektfreigaben, Tags, Einstellungen und Auditereignisse.

## Rechte

Benutzer werden ausschließlich von Administratoren angelegt. Administratoren haben vollständigen Zugriff. Bearbeiter dürfen freigegebene Projekte lesen und ändern, Leser nur lesen. Der Projektzugriff unterstützt alle Projekte, eine Positivliste oder eine Negativliste. Deaktivierte Benutzer und widerrufene Sitzungen werden unmittelbar serverseitig abgewiesen.

Die Oberfläche ist nie die Sicherheitsgrenze. Jeder API-Aufruf prüft Sitzung, Rolle und gegebenenfalls Projektfreigabe.

## Dauerhafte Links

- Projekt: `/p/{projectId}`
- Arbeitsschritt: `/p/{projectId}/e/{entryId}`

IDs sind opak und unveränderlich. Die Oberfläche kopiert relative Links auf die aktuell verwendete Domain. Für NFC-Tags sollte von Anfang an eine dauerhaft kontrollierte Domain oder Subdomain verwendet werden; bei einem Umzug wird diese auf die neue Installation umgestellt.

## Betrieb

Auf Shared Hosting wird der Ordner hochgeladen und die Subdomain auf `public/` gerichtet. In Docker bindet ein Volume den gesamten Ordner `storage/` ein. Datenmodell, API, Oberfläche und Migrationen bleiben identisch.

Der Einrichtungsassistent prüft PHP-Version, Erweiterungen und Schreibrechte, legt das SQLite-Schema an und erstellt genau ein erstes Administratorkonto. Weitere Schemaänderungen werden versioniert und beim Start eingespielt.

## Backups und Hintergrundjobs

Projekt- und Benutzerbackups bleiben getrennt. Benutzerarchive enthalten Passwort-Hashes, aber keine Klartextpasswörter oder Sitzungen, und müssen deshalb wie Geheimnisse behandelt werden.

Automatischer E-Mail-Versand benötigt zusätzlich einen serverseitigen, wiederholbaren Job. Für Webhosting soll ein Cron-Aufruf bereitgestellt werden, für Docker derselbe Job in einem separaten Prozess oder über den Container-Zeitplan. Der Webprozess selbst soll nicht auf SMTP-Timeouts warten.

