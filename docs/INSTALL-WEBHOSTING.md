# Make:Log auf Webhosting installieren

## Voraussetzungen

- PHP 8.2 oder neuer
- SQLite-Unterstützung für PHP
- HTTPS für die verwendete Domain oder Subdomain
- eine einstellbare Ziel- beziehungsweise Document-Root der Subdomain

## Installation

1. Einen Ordner wie `makelog` auf dem Webspace anlegen.
2. Den vollständigen Inhalt des Make:Log-Pakets dorthin hochladen.
3. Im Hosting-Menü eine Subdomain wie `log.example.de` anlegen.
4. Als Zielordner der Subdomain `makelog/public` wählen.
5. PHP 8.2 oder neuer aktivieren.
6. Prüfen, dass PHP in `makelog/storage` schreiben darf. Üblicherweise stimmen die Rechte nach dem FTP-Upload bereits; andernfalls für diesen Ordner Schreibrechte des Webserver-Benutzers aktivieren.
7. `https://log.example.de` öffnen und den Einrichtungsassistenten abschließen.

Eine MySQL-Datenbank muss nicht angelegt werden. Make:Log erzeugt seine SQLite-Datenbank selbst.

## Wenn nur der Webroot hochgeladen werden kann

Anwendungscode und `storage/` dürfen nicht öffentlich abrufbar sein. Kann der Document-Root nicht auf `public/` gesetzt werden, ist dieser Tarif für die vorgesehene sichere Standardinstallation ungeeignet. Die Dateien sollten nicht einfach gemeinsam in einen öffentlichen Ordner gelegt werden.

## Updates

Vor einem Update beide Backups herunterladen. Danach `app/` und `public/` durch die neue Version ersetzen; `storage/` niemals überschreiben. Beim nächsten Aufruf führt Make:Log notwendige Datenbankmigrationen automatisch aus.

