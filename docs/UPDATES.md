# Updates veröffentlichen und installieren

## Sicherheitsmodell

Quellcode, Issues und Release-Dateien liegen gemeinsam im öffentlichen Repository `johannesboernsen/logbuch`. Das Logbuch installiert niemals einen Branch oder einen veränderlichen Tag. GitHub Releases enthalten ein Webpaket sowie ein RSA-/SHA-256-signiertes Manifest. Dieses Manifest bindet Version, Webdateien und die SHA-256-Digests beider Docker-Images kryptografisch aneinander.

Der öffentliche Schlüssel liegt in `config/update-public-key.pem` und zusätzlich im AIO-Updater-Image. Der zugehörige private Schlüssel darf niemals committed, in ein Image eingebaut oder auf einer Installation abgelegt werden. Er wird ausschließlich als GitHub-Actions-Secret `UPDATE_SIGNING_PRIVATE_KEY` verwendet.

## Release erstellen

1. `VERSION` auf die gewünschte semantische Version setzen.
2. In `CHANGELOG.md` den Abschnitt `[Unveröffentlicht]` in die neue Version mit Datum umbenennen und einen neuen leeren Abschnitt `[Unveröffentlicht]` darüber anlegen. Der Versionsabschnitt benötigt einen Kurztext und die Überschrift `Wichtigste Änderungen` mit einer Stichpunktliste.
3. Bei einer Schemaänderung `SCHEMA_VERSION` erhöhen und für jede neue Zahl eine Datei wie `database/migrations/007.sql` hinzufügen. Migrationen dürfen keine eigenen Transaktionsbefehle, `ATTACH`, `DETACH` oder `VACUUM` enthalten.
4. Änderungen committen und einen passenden Tag pushen, beispielsweise `v0.3.0`.
5. `.github/workflows/release.yml` führt Tests aus, baut das Web-TAR und die Multi-Arch-Images `logbuch` und `logbuch-updater`, übernimmt den passenden Changelog-Abschnitt in Update-Manifest und GitHub Release, signiert das Manifest und veröffentlicht alle Dateien gemeinsam.

Benötigt wird nur das Actions-Secret `UPDATE_SIGNING_PRIVATE_KEY`. Für Releases und GHCR werden die auf dieses Repository beschränkten Rechte des `GITHUB_TOKEN` verwendet; ein persönliches Zugriffstoken und ein zweites Repository sind nicht nötig.

Das Webpaket enthält nur Programmdateien. `storage/`, `.env`, Git-Dateien und lokale Update-Sicherungen werden nicht veröffentlicht. Beide GHCR-Pakete müssen öffentlich lesbar sein, damit Installationen für Updates keine Zugangsdaten speichern müssen.

## Webhosting

Unter **Einstellungen → System** kann ein Administrator nach erneuter Passworteingabe aktualisieren. Das Logbuch prüft Signatur, Prüfsummen, PHP-Version, Schreibrechte und lokale Dateiänderungen. Danach werden eine SQLite-Sicherung und eine Sicherung der bisherigen Programmdateien angelegt, der Wartungsmodus aktiviert und die neue Version atomar eingespielt.

Schemaänderungen laufen innerhalb derselben Datenbanktransaktion wie der Programmwechsel. Scheitert ein Schritt, werden Datenbanktransaktion und Programmdateien zurückgesetzt. Die letzten drei Update-Sicherungen bleiben in `storage/updates/backups/` erhalten.

Hat der PHP-Benutzer keine Schreibrechte auf den Installationsordner, bleibt die Prüfung verfügbar, die Schaltfläche zur Installation wird jedoch deaktiviert. Dann muss das Release manuell hochgeladen werden.

## Docker AIO

`docker compose up -d` legt Anwendung und AIO-Updater gemeinsam an. In der Admin-Oberfläche bleibt der Ablauf ein einziger Klick mit Passwortbestätigung:

1. Die Anwendung prüft die Release-Signatur und schreibt eine Update-Anforderung in `logbuch-data`.
2. Der AIO-Updater liest diese Anforderung und prüft Signatur, erlaubte Image-Namen und beide Digests unabhängig erneut.
3. Er lädt das neue App-Image, ersetzt ausschließlich den App-Container und wartet auf dessen Healthcheck.
4. Bei einem Fehler stellt er automatisch das zuvor verwendete Image wieder her.
5. Nach erfolgreichem App-Update aktualisiert ein kurzlebiger Handoff-Container bei Bedarf auch den AIO-Updater selbst.

Der Webprozess und der App-Container erhalten keinen Zugriff auf `/var/run/docker.sock`. Nur der kleine, nicht über das Netzwerk erreichbare Updater-Container besitzt diesen Zugriff. SSH, Cron und Hostskripte sind nicht erforderlich.

Nach der Passwortbestätigung bleibt eine Fortschrittsansicht geöffnet. Der Browser toleriert die erwartete kurze Unterbrechung, prüft die installierte Version regelmäßig und lädt die Seite automatisch neu, sobald die Zielversion erreichbar ist. Nach drei Minuten ohne eindeutiges Ergebnis wird stattdessen eine Schaltfläche zum manuellen Neuladen angeboten.

## Konfiguration für Forks

Folgende Werte werden ausschließlich in der Server- oder Container-Konfiguration gesetzt und sind bewusst nicht über die Weboberfläche änderbar:

- `LOGBUCH_UPDATE_MANIFEST_URL`
- `LOGBUCH_UPDATE_SIGNATURE_URL`
- `LOGBUCH_UPDATE_PUBLIC_KEY_PATH`
- `LOGBUCH_UPDATE_IMAGE`
- `LOGBUCH_UPDATE_UPDATER_IMAGE`
