# Öffentliche Projektübersichten

Öffentliche Projektübersichten sind bewusst von den angemeldeten Projektansichten getrennt. Ein nicht erratbarer, widerrufbarer Link erlaubt den lesenden Zugriff ohne Benutzerkonto. Die interne Projekt-API bleibt dabei vollständig geschützt.

## Freigabebereiche

- `ALL`: alle Projekte mit den regulären Status Idee, Aktiv, Pausiert oder Abgeschlossen
- `STATUS`: alle Projekte mit genau einem dieser Status
- `FOLDER`: alle regulären Projekte in einem Ordner und seinem vollständigen Unterbaum, unabhängig vom Status

Die Ansicht wird bei jedem Aufruf neu aus dem aktuellen Projektbestand erzeugt. Neue oder geänderte Projekte erscheinen daher ohne erneuten Export.

## Öffentliche Daten

Die öffentliche Schnittstelle liefert ausschließlich:

- Projektname
- Beschreibung
- Status
- Fälligkeit
- die für die Navigation benötigten Ordnernamen

Projekt-IDs, Ordner-IDs, Inhalte, Dateien, Benutzer, Tags und Änderungsverläufe werden nicht ausgegeben. Ordner erhalten pro Freigabe abgeleitete, nicht rückrechenbare Navigationsschlüssel.

## Verwaltung und Sicherheit

Nur Administratoren können Freigaben erstellen und verwalten. Jede Freigabe besitzt einen zufälligen Token mit 256 Bit Entropie und kann optional ablaufen. Beim Erneuern wird der bisherige Token sofort ungültig; beim Deaktivieren endet der öffentliche Zugriff unmittelbar.

Öffentliche Seiten senden `noindex`, `nofollow`, `noarchive`, `no-store` und `no-referrer`. Die erzeugte Adresse verwendet die in den Systemeinstellungen hinterlegte öffentliche Webadresse. Ist diese nur im lokalen Netz erreichbar, gilt das auch für die Freigabe.

Freigaben werden im vollständigen Backup gesichert und beim Löschen aller Inhalte entfernt.
