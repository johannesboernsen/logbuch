# Änderungsprotokoll

Hier werden die wichtigen Änderungen des Logbuchs festgehalten. Die Einträge sind nach Versionen geordnet und beschreiben vor allem sichtbare Neuerungen, Verhaltensänderungen und behobene Probleme.

## [Unveröffentlicht]

### Wichtigste Änderungen

- Noch keine Einträge.

## [0.7.3] - 2026-09-03

Artikel lassen sich schneller im passenden Lager- oder Kategorienkontext erfassen; kompakte Spaltenauswahlen vereinheitlichen dabei die Navigation durch hierarchische Strukturen.

### Wichtigste Änderungen

- In den Spaltenansichten kann über das Plus eines Lagerorts oder einer Kategorie direkt ein neuer Artikel angelegt und dem jeweiligen Ort oder Kategorienzweig zugeordnet werden; am Lagerort lässt sich dabei auch der Anfangsbestand erfassen.
- Kategorien und Lagerorte werden in Zuordnungsdialogen über dieselbe kompakte Spaltenansicht ausgewählt; Navigation, Hervorhebung und Leerflächen-Verhalten bleiben dadurch an allen Einsatzorten einheitlich.
- Der Artikeldialog ordnet optionale Angaben konsistent an und bietet große Minus-/Plus-Schaltflächen für Anfangs- und Mindestbestände.
- Die große Kategorienansicht unterstützt nun wie die Lageransicht das Aufheben einer Auswahl über freie Spaltenflächen sowie die Navigation mit den Pfeiltasten.

## [0.7.2] - 2026-09-03

Lose Sammlungen erweitern das Lager um Artikel ohne Mengenerfassung; zugleich werden Änderungen neuer Versionen direkt beim Update sichtbar.

### Wichtigste Änderungen

- Artikel können als „Lose Sammlung ohne Mengenerfassung“ geführt und mit einem Lagerort versehen werden.
- Lose Sammlungen lassen sich gleichzeitig mehreren Projekten zuordnen, ohne dafür künstliche Bestandsmengen zu erfassen.
- Das Veröffentlichungsverfahren übernimmt die wichtigsten Änderungen aus diesem Changelog in das signierte Update-Manifest und in die GitHub Release Notes.
- Verfügbare Updates zeigen ihre wichtigsten Änderungen direkt in den Logbuch-Systemeinstellungen an.

## [0.7.1] - 2026-08-31

Das Lager und der projektbezogene KI-Export wurden umfassend erweitert.

### Wichtigste Änderungen

- Hierarchische Lagerkategorien mit Mehrfachzuordnung und Drag-and-drop ergänzt.
- Vollständige Backups sichern nun Projekte, Benutzer, Erinnerungen und sämtliche Lagerdaten gemeinsam.
- Artikel und Lagerorte können nach einer Abhängigkeitsprüfung endgültig gelöscht werden.
- Einzelne Projekte lassen sich als strukturierter Markdown-Kontext für Gespräche mit einer KI herunterladen.
- Die Artikel- und Lageransichten wurden für große und kleine Bildschirme überarbeitet.

## [0.7.0] - 2026-08-28

Mit dieser Version wurde die eigenständige Lagerverwaltung eingeführt.

### Wichtigste Änderungen

- Artikelstammdaten, verschachtelte Lagerorte und physische Bestände ergänzt.
- Zugänge, Entnahmen, Korrekturen und Umlagerungen werden nachvollziehbar protokolliert.
- Material kann mengenbezogen für Projekte und Arbeitsschritte reserviert und entnommen werden.
- Eine Nachbestellansicht verbindet Mindestbestände mit offenem Projektbedarf.
- Der Lagerfinder unterstützt direkte Navigation und Drag-and-drop-Umlagerungen.

## [0.6.1] - 2026-08-27

Kleinere Korrekturen verbesserten die Bedienung der Projektansicht.

### Wichtigste Änderungen

- Beschriftungen und Zustände in der Projektoberfläche wurden vereinheitlicht.
- Die Darstellung und Bedienung bestehender Projektinhalte wurde stabilisiert.

## [0.6.0] - 2026-08-26

Projektinhalte wurden in einer gemeinsamen, übersichtlichen Erfassung zusammengeführt.

### Wichtigste Änderungen

- Ein zentrales Hinzufügen-Menü für alle Arten von Projektinhalten ergänzt.
- Eine eigene Einkaufsliste mit Status, Priorität, Händler und Preis eingeführt.
- Projektbereiche lassen sich ein- und ausklappen und bleiben auch bei vielen Inhalten übersichtlich.
- Dateien können verschiedenen Projektinhalten direkt zugeordnet werden.

## [0.5.1] - 2026-08-24

Erinnerungen und Navigation wurden enger mit Projekten verbunden.

### Wichtigste Änderungen

- Erinnerungen können in ein neues Projekt umgewandelt werden.
- Projekt- und Update-Hinweise sind direkt in der Navigation sichtbar.
- Benennungen und visuelle Details der Oberfläche wurden vereinheitlicht.

## [0.5.0] - 2026-08-24

Der persönliche Erinnerungsbereich erhielt Wiederholungen und eine klarere Organisation.

### Wichtigste Änderungen

- Wiederkehrende Erinnerungen in Tages-, Wochen-, Monats- und Jahresabständen ergänzt.
- Erinnerungen können gruppiert, sortiert, aufgeräumt und geschützt wieder geöffnet werden.
- Benutzerbackups bewahren persönliche Erinnerungen einschließlich ihrer Wiederholungen.

## [0.4.2] - 2026-08-23

Suche, Exporte und persönliche Aufgaben wurden deutlich ausgebaut.

### Wichtigste Änderungen

- Globale Suche über Projekte und Projektinhalte ergänzt.
- Projekte können als Rohdaten, Druckansicht und PDF ausgegeben werden.
- Persönliche Aufgaben sowie Projekt- und Benutzerbackups erweitert.
- Rollen und Projektfreigaben werden auch beim direkten API-Zugriff geprüft.

## [0.4.1] - 2026-08-23

Die responsive Bedienung und Darstellung wurden weiter verfeinert.

### Wichtigste Änderungen

- Projektkarten, Navigation und Dialoge wurden für kleinere Bildschirme optimiert.
- Bedienelemente und Statusdarstellungen wurden visuell vereinheitlicht.

## [0.4.0] - 2026-08-23

Die Projektübersicht erhielt zusätzliche Struktur- und Bedienmöglichkeiten.

### Wichtigste Änderungen

- Projektgruppen und Statusdarstellungen wurden ausgebaut.
- Projektlisten und Detailansichten erhielten eine kompaktere Bedienung.
- Beispieldaten und Oberflächentests wurden an den erweiterten Funktionsumfang angepasst.

## [0.3.4] - 2026-08-22

### Wichtigste Änderungen

- Unlesbare Laufzeitdateien beeinträchtigen JSON-Antworten nicht mehr.

## [0.3.3] - 2026-08-22

### Wichtigste Änderungen

- Der Fortschritt eines laufenden Docker-Updates bleibt während Neustart und Healthcheck sichtbar.

## [0.3.2] - 2026-08-22

### Wichtigste Änderungen

- Zugriffsrechte des gemeinsam verwendeten Docker-Speichers wurden korrigiert.

## [0.3.1] - 2026-08-22

### Wichtigste Änderungen

- Vollbackups bleiben über Aktualisierungen und Schemaänderungen hinweg kompatibel.

## [0.3.0] - 2026-08-22

### Wichtigste Änderungen

- Signierte Updates für Webhosting eingeführt.
- Ein separater Docker-AIO-Updater übernimmt Aktualisierung, Healthcheck und Rollback.

## [0.2.1] - 2026-08-22

### Wichtigste Änderungen

- Der Release-Prozess toleriert auf privaten Repositories nicht verfügbare Attestierungen.

[Unveröffentlicht]: https://github.com/johannesboernsen/logbuch/compare/v0.7.2...HEAD
[0.7.2]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.7.2
[0.7.1]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.7.1
[0.7.0]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.7.0
[0.6.1]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.6.1
[0.6.0]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.6.0
[0.5.1]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.5.1
[0.5.0]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.5.0
[0.4.2]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.4.2
[0.4.1]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.4.1
[0.4.0]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.4.0
[0.3.4]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.3.4
[0.3.3]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.3.3
[0.3.2]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.3.2
[0.3.1]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.3.1
[0.3.0]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.3.0
[0.2.1]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.2.1
