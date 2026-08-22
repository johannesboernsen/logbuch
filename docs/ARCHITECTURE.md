# Zielarchitektur

## Ein Kern, zwei Installationsarten

Das Logbuch ist eine PHP-Anwendung. Docker enthält denselben PHP-Code und ist nur eine alternative Verpackung. Dadurch entstehen keine getrennten Docker- und Webhosting-Versionen.

```text
Browser
  │ HTTPS + /api/* + stabile /p/{id}-Links
  ▼
public/index.php
  │
  ├── Anmeldung, Sitzung, CSRF und Rechte
  ├── Projekte, Arbeitsschritte und Sammlungen
  ├── Benutzer, Tags, Einstellungen und Protokoll
  └── Export und Import manueller Backups
       │
       ├── Markdown + JSON in storage/projects/
       └── SQLite in storage/database.sqlite
```

Der öffentliche Webserver zeigt ausschließlich auf `public/`. Anwendungscode und Daten liegen außerhalb dieses Dokumentenstamms. Docker setzt dieselbe Trennung über seine Apache-Konfiguration um.

## Offene Projektdaten

Jeder fachliche Datensatz besitzt eine JSON-Datei und eine Markdown-Datei mit YAML-Frontmatter. JSON ermöglicht eine verlustfreie Wiederherstellung und schnelle Verarbeitung; Markdown bleibt ohne das Logbuch lesbar. Schreibvorgänge verwenden eine temporäre Datei und ein anschließendes atomisches Umbenennen.

SQLite ist für transaktionale Daten vorgesehen: Benutzer, Argon2id-Hashes, Sitzungen, Anmeldebegrenzung, Projektfreigaben, Tags, Einstellungen und Auditereignisse.

Der versionierte Beispieldatensatz liegt in `public/demo-data.json`. Seine Projekt-, Ordner- und Tag-IDs verwenden den reservierten Präfix `demo-`. Installation und Entfernen laufen ausschließlich serverseitig über administrative API-Endpunkte. Beim Entfernen werden nur die im Manifest aufgeführten Projekt-IDs gelöscht. Ein Demo-Ordner wird anschließend nur entfernt, wenn er weder eigene Projekte noch Unterordner enthält; belegte Demo-Ordner und die darin einsortierten eigenen Inhalte bleiben unverändert erhalten. Nachträglich innerhalb eines Demo-Projekts gespeicherte Einträge liegen in dessen Projektverzeichnis und werden zusammen mit diesem entfernt. Gleichnamige, bereits vorhandene Nutzertags werden beim Einspielen wiederverwendet und beim Entfernen nicht gelöscht.

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

## Updates

GitHub Releases liefern ein signiertes Manifest, ein TAR-Paket für Webhosting und ein digest-gepinntes GHCR-Image. Das Logbuch vertraut nicht auf Branches oder veränderliche Image-Tags. Das Manifest bindet jede ausgelieferte Webdatei und den Container-Digest kryptografisch an einen Release.

Auf Webhosting arbeitet der Updater mit einer exklusiven Sperre, einem Wartungsmarker, atomaren Dateiersetzungen und einer SQLite-Transaktion für neue Migrationen. Lokale Änderungen an Dateien eines zuvor erfassten Releases blockieren das Update. `storage/` gehört nie zur verwalteten Dateiliste.

In Docker endet die Verantwortung der Anwendung beim Schreiben einer Update-Anforderung in das persistente Volume. Ein separater, nicht über das Netzwerk erreichbarer AIO-Updater prüft die signierte Anforderung nochmals, aktualisiert App und Updater anhand fester Digests und führt den Healthcheck mit automatischer Wiederherstellung aus. Nur dieser Hilfscontainer besitzt den Docker-Socket; der Webprozess und der App-Container haben keine Kontrolle über den Docker-Daemon.

## Backups

Projekt- und Benutzerbackups bleiben getrennt. Projektarchive enthalten Projekte, verwendete Tags, Projektordner und Servereinstellungen; Benutzerarchive enthalten Konten, Projektfreigaben, persönliche Einstellungen und Passwort-Hashes. Klartextpasswörter und Sitzungen werden nicht exportiert. Benutzerarchive müssen deshalb wie Geheimnisse behandelt werden. Für eine vollständige Wiederherstellung wird zuerst das Benutzer- und danach das Projektarchiv eingespielt; ältere Archive bleiben importierbar, können aber nur Daten wiederherstellen, die sie bereits enthielten.

Backups werden bewusst manuell heruntergeladen und wieder eingespielt. Das Logbuch speichert keine SMTP-Zugangsdaten und führt keine Hintergrundjobs aus.
