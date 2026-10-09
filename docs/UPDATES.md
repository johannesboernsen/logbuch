# Updates veröffentlichen und installieren

## Sicherheitsmodell

Quellcode, Issues und Release-Dateien liegen gemeinsam im öffentlichen Repository `johannesboernsen/logbuch`. Das Logbuch installiert niemals einen Branch oder einen veränderlichen Tag. GitHub Releases enthalten ein Webpaket sowie ein RSA-/SHA-256-signiertes Manifest. Dieses Manifest bindet Version, Webdateien und die SHA-256-Digests beider Docker-Images kryptografisch aneinander.

Der öffentliche Schlüssel liegt in `config/update-public-key.pem` und zusätzlich im AIO-Updater-Image. Der zugehörige private Schlüssel darf niemals committed, in ein Image eingebaut oder auf einer Installation abgelegt werden. Für Releases wird er ausschließlich als Secret `UPDATE_SIGNING_PRIVATE_KEY` der geschützten GitHub-Actions-Umgebung `update-signing` verwendet; eine Offline-Wiederherstellungskopie kann im persönlichen Schlüsselbund des Release-Verantwortlichen liegen. **Ein gleichnamiges Repository-Secret muss gelöscht werden:** Ein alter Release-Workflow aus einem früheren Tag könnte sonst weiterhin darauf zugreifen. Falls der Schlüssel bereits einem nicht vertrauenswürdigen Tag-Workflow zugänglich war, muss das Schlüsselpaar rotiert und der neue öffentliche Schlüssel in Anwendung und Updater veröffentlicht werden.

Für 0.9.2 wurde das Schlüsselpaar gewechselt. Die private Hälfte liegt in der geschützten GitHub-Umgebung; eine Wiederherstellungskopie wurde in den macOS-Anmeldeschlüsselbund des Release-Verantwortlichen importiert. Die bisherige private Hälfte ist nicht mehr verfügbar. Bestehende Webhosting-Installationen müssen 0.9.2 einmal manuell erhalten, damit sie dem neuen öffentlichen Schlüssel vertrauen. Vorher können sie kein mit dem neuen Schlüssel signiertes Update in der Anwendung installieren.

## Release erstellen

1. `VERSION` auf die gewünschte semantische Version setzen.
2. In `CHANGELOG.md` den Abschnitt `[Unveröffentlicht]` in die neue Version mit Datum umbenennen und einen neuen leeren Abschnitt `[Unveröffentlicht]` darüber anlegen. Der Versionsabschnitt benötigt einen Kurztext und die Überschrift `Wichtigste Änderungen` mit einer Stichpunktliste.
3. Bei einer Schemaänderung `SCHEMA_VERSION` erhöhen und für jede neue Zahl eine Datei wie `database/migrations/007.sql` hinzufügen. Migrationen dürfen keine eigenen Transaktionsbefehle, `ATTACH`, `DETACH` oder `VACUUM` enthalten.
4. Änderungen in den geschützten Branch `main` übernehmen und einen passenden Tag auf diesem Commit pushen, beispielsweise `v0.3.0`.
5. `.github/workflows/release.yml` führt Tests aus und speichert nur Tag und Commit als Kandidat. Dieser Tag-Workflow erhält weder Signierschlüssel noch Paket- oder Release-Schreibrechte.
6. `.github/workflows/release-publish.yml` läuft vom Standardbranch: Er prüft, dass der Tag noch auf den auslösenden Commit zeigt, dieser Commit auf `main` liegt und `VERSION` passt. Separate Jobs bauen und veröffentlichen die Multi-Arch-Images zunächst unter versionsgebundenen Tags, erstellen das Web-TAR und prüfen Manifest, Archiv-Prüfsumme und Image-Auswahl. Der Signierjob erhält erst nach den Schutzregeln der Umgebung `update-signing` Zugriff auf den Schlüssel und checkt keinen Tag-Code aus. Ein weiterer Job veröffentlicht Signatur, GitHub Release und die `stable`-Image-Tags ohne Signierschlüssel.

Vor dem nächsten Tag-Push muss die Umgebung `update-signing` mit erforderlicher Freigabe durch einen Release-Verantwortlichen und einer Beschränkung auf den geschützten Branch `main` eingerichtet sein. Den privaten Schlüssel dort als **Umgebungs-Secret** und `UPDATE_SIGNING_ENV_READY=yes` als **Umgebungsvariable** hinterlegen; das alte Repository-Secret löschen. Ohne die Variable bricht der Signierjob ab. Die Workflows lassen sich ohne diese GitHub-Einstellungen nicht allein durch Repository-Dateien absichern. Für Releases und GHCR werden die auf dieses Repository beschränkten Rechte des `GITHUB_TOKEN` verwendet; ein persönliches Zugriffstoken und ein zweites Repository sind nicht nötig.

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

Die Anwendung teilt mit dem Updater nur Update-Anforderungen und Statusmeldungen über `logbuch-data`. Die vom Updater verwendeten Compose-Umgebungsdateien, Image-Auswahl und Wiederherstellungsdaten liegen im separaten Volume `logbuch-updater-state`, das nicht in die Anwendung eingehängt wird. Bei einer bestehenden Installation die aktualisierte `compose.yaml` mit `docker compose up -d` anwenden, damit das zusätzliche Volume eingebunden wird.

Der Updater vergleicht jede signierte Release-Version mit der laufenden Anwendung und einem privaten, dauerhaft gespeicherten Versionsstand. Er nimmt eine Version nur einmal an und lehnt ältere oder gleiche Releases ab, auch wenn eine alte Anforderungsdatei erneut in `logbuch-data` abgelegt wird. Der Versionsstand wird vor dem Start der neuen Images gespeichert; nach einem fehlgeschlagenen Update kann deshalb dieselbe Release-Version nicht automatisch erneut versucht werden. Für einen erneuten Versuch ist eine neuere signierte Version erforderlich.

Nach der Passwortbestätigung bleibt eine Fortschrittsansicht geöffnet. Der Browser toleriert die erwartete kurze Unterbrechung, prüft die installierte Version regelmäßig und lädt die Seite automatisch neu, sobald die Zielversion erreichbar ist. Nach drei Minuten ohne eindeutiges Ergebnis wird stattdessen eine Schaltfläche zum manuellen Neuladen angeboten.

## Konfiguration für Forks

Folgende Werte werden ausschließlich in der Server- oder Container-Konfiguration gesetzt und sind bewusst nicht über die Weboberfläche änderbar:

- `LOGBUCH_UPDATE_MANIFEST_URL`
- `LOGBUCH_UPDATE_SIGNATURE_URL`
- `LOGBUCH_UPDATE_PUBLIC_KEY_PATH`
- `LOGBUCH_UPDATE_IMAGE`
- `LOGBUCH_UPDATE_UPDATER_IMAGE`
