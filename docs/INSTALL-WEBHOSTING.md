# Das Logbuch auf Webhosting installieren

## Voraussetzungen

- PHP 8.2 oder neuer
- SQLite-Unterstützung für PHP
- HTTPS für die verwendete Domain oder Subdomain
- eine einstellbare Ziel- beziehungsweise Document-Root der Subdomain

## Installation

1. Einen Ordner wie `logbuch` auf dem Webspace anlegen.
2. Den vollständigen Inhalt des Logbuch-Pakets dorthin hochladen.
3. Im Hosting-Menü eine Subdomain wie `log.example.de` anlegen.
4. Als Zielordner der Subdomain `logbuch/public` wählen.
5. PHP 8.2 oder neuer aktivieren.
6. Prüfen, dass PHP in `logbuch/storage` schreiben darf. Üblicherweise stimmen die Rechte nach dem FTP-Upload bereits; andernfalls für diesen Ordner Schreibrechte des Webserver-Benutzers aktivieren.
7. `https://log.example.de` öffnen und den Einrichtungsassistenten abschließen.

Eine MySQL-Datenbank muss nicht angelegt werden. Das Logbuch erzeugt seine SQLite-Datenbank selbst.

## Wenn nur der Webroot hochgeladen werden kann

Anwendungscode und `storage/` dürfen nicht öffentlich abrufbar sein. Kann der Document-Root nicht auf `public/` gesetzt werden, ist dieser Tarif für die vorgesehene sichere Standardinstallation ungeeignet. Die Dateien sollten nicht einfach gemeinsam in einen öffentlichen Ordner gelegt werden.

## Updates

Administratoren werden unter **Einstellungen → System** auf ein signiertes GitHub Release hingewiesen. Darf PHP die Programmdateien verändern, kann das Update dort nach erneuter Eingabe des Administratorpassworts direkt installiert werden. Das Logbuch erstellt vorher automatisch eine SQLite- und Programmsicherung, aktiviert den Wartungsmodus und rollt einen fehlgeschlagenen Dateitausch zurück. `storage/` wird niemals durch ein Release überschrieben.

Fehlen Schreibrechte, bleibt das manuelle Verfahren möglich: zuerst beide Browser-Backups herunterladen und anschließend `app/`, `public/`, `config/`, `VERSION` und `SCHEMA_VERSION` aus dem neuen Webpaket ersetzen. `storage/` niemals überschreiben. Beim nächsten Aufruf führt das Logbuch notwendige Datenbankmigrationen automatisch aus.
