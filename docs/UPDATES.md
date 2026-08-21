# Updates veröffentlichen und installieren

## Sicherheitsmodell

Make:Log installiert niemals einen Git-Branch. Der Quellcode liegt im privaten Repository `johannesboernsen/make-log`; öffentlich erreichbar sind ausschließlich die für automatische Updates benötigten, signierten Artefakte im Repository `johannesboernsen/make-log-releases`. Das Release-Manifest wird mit RSA/SHA-256 signiert; erst danach werden Version, PHP-Anforderung, Dateihashes, Webpaket und Docker-Digest ausgewertet.

Die Trennung hält Commit-Historie, Branches, Issues und Entwicklung intern. Das ausgelieferte Webpaket enthält zwangsläufig den ausführbaren PHP-Code und ist daher kein Schutz vor Einsicht in die veröffentlichte Programmversion.

Der öffentliche Schlüssel liegt in `config/update-public-key.pem`. Der zugehörige private Schlüssel darf niemals committed oder auf einem Webserver abgelegt werden. Für dieses Repository ist er als GitHub-Actions-Secret `UPDATE_SIGNING_PRIVATE_KEY` und zusätzlich im macOS-Anmeldeschlüsselbund des Maintainers gesichert; die unverschlüsselte lokale Datei wurde entfernt. Bei einer neuen Schlüsselgeneration muss derselbe Ablauf eingehalten werden.

## Release erstellen

1. `VERSION` auf die gewünschte semantische Version setzen.
2. Bei einer Schemaänderung `SCHEMA_VERSION` erhöhen und für jede neue Zahl eine Datei wie `database/migrations/007.sql` hinzufügen. Migrationen dürfen keine eigenen Transaktionsbefehle, `ATTACH`, `DETACH` oder `VACUUM` enthalten.
3. Änderungen committen und einen passenden Tag pushen, beispielsweise `v0.3.0`.
4. `.github/workflows/release.yml` führt Tests aus, baut das Web-TAR und ein Multi-Arch-Image, signiert das Manifest, erstellt Attestierungen und veröffentlicht den GitHub Release im öffentlichen Download-Repository.

Dafür benötigt das private Quellcode-Repository zwei Actions-Secrets:

- `UPDATE_SIGNING_PRIVATE_KEY`: privater Signaturschlüssel.
- `RELEASE_REPOSITORY_TOKEN`: fein abgestuftes GitHub-Token mit Zugriff ausschließlich auf `make-log-releases` und der Repository-Berechtigung **Contents: Read and write**.

Das automatisch bereitgestellte `GITHUB_TOKEN` bleibt auf das private Quellcode-Repository begrenzt und wird nur zum Veröffentlichen des Container-Images und der Attestierungen verwendet. Nach der ersten Veröffentlichung muss das GHCR-Paket `ghcr.io/johannesboernsen/make-log` einmalig auf **Public** gestellt werden, damit Docker-Installationen ohne Registry-Zugangsdaten aktualisieren können. Die Umstellung eines Pakets auf öffentlich ist bei GitHub nicht ohne Weiteres rückgängig zu machen.

Das Webpaket enthält nur Programmdateien. `storage/`, `.env`, Git-Dateien und lokale Update-Sicherungen werden nicht veröffentlicht.

## Webhosting

Unter **Einstellungen → System** kann ein Administrator nach erneuter Passworteingabe aktualisieren. Make:Log prüft Signatur, Prüfsummen, PHP-Version, Schreibrechte und lokale Dateiänderungen. Danach werden eine SQLite-Sicherung und eine Sicherung der bisherigen Programmdateien angelegt, der Wartungsmodus aktiviert und die neue Version atomar eingespielt.

Schemaänderungen laufen innerhalb derselben Datenbanktransaktion wie der Programmwechsel. Scheitert ein Schritt, werden Datenbanktransaktion und Programmdateien zurückgesetzt. Die letzten drei Update-Sicherungen bleiben in `storage/updates/backups/` erhalten.

Hat der PHP-Benutzer keine Schreibrechte auf dem Installationsordner, bleibt die Prüfung verfügbar, die Schaltfläche zur Installation wird jedoch deaktiviert. Dann muss das Release weiterhin manuell hochgeladen werden.

## Docker

Make:Log schreibt nach der Bestätigung nur `makelog-data/updates/docker-request.json`. Der Container erhält keinen Zugriff auf `/var/run/docker.sock`.

Der Host-Helfer wird auf dem Docker-Host regelmäßig ausgeführt:

```sh
./tools/makelog-docker-updater.sh /pfad/zum/makelog-ordner
```

Er akzeptiert ausschließlich `ghcr.io/johannesboernsen/make-log` mit einem vollständigen SHA-256-Digest, aktualisiert `MAKELOG_IMAGE` in `.env`, führt `docker compose pull` und `docker compose up -d --wait` aus und stellt bei einem Fehler die vorherige `.env` wieder her. Für einen Ein-Klick-Ablauf kann der Befehl minütlich per Cron oder NAS-Aufgabenplaner gestartet werden.

Beispiel für Cron:

```cron
* * * * * /absoluter/pfad/make-log/tools/makelog-docker-updater.sh /absoluter/pfad/make-log
```

Ohne Host-Helfer bleibt die Anforderung in der Warteschlange und kann jederzeit durch einen manuellen Aufruf verarbeitet werden.

### macOS

Liegt das Projekt in `Dokumente`, kann macOS den klassischen Cron-Daemon am Zugriff hindern. In diesem Fall sollte ein benutzerspezifischer LaunchAgent verwendet werden. Auf dem Entwicklungsrechner dieses Repositorys ist er bereits als `de.makelog.docker-updater` installiert. Seine Dateien liegen hier:

- `~/Library/LaunchAgents/de.makelog.docker-updater.plist`
- `~/Library/Application Support/MakeLog/makelog-docker-updater.sh`
- `~/Library/Logs/MakeLog-Docker-Updater.log`

Der Dienst läuft alle 60 Sekunden und besitzt keinen Docker-Socket im Make:Log-Container.

## Konfiguration

Für einen Fork lassen sich die Updatequellen serverseitig setzen:

- `MAKELOG_UPDATE_MANIFEST_URL`
- `MAKELOG_UPDATE_SIGNATURE_URL`
- `MAKELOG_UPDATE_PUBLIC_KEY_PATH`
- `MAKELOG_UPDATE_IMAGE`

Diese Werte gehören in die Server- beziehungsweise Container-Konfiguration und sind bewusst nicht über die Weboberfläche änderbar.
