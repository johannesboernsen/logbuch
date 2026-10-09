# Änderungsprotokoll

Hier werden die wichtigen Änderungen des Logbuchs festgehalten. Die Einträge sind nach Versionen geordnet und beschreiben vor allem sichtbare Neuerungen, Verhaltensänderungen und behobene Probleme.

## [Unveröffentlicht]

## [0.9.2] - 2026-10-09

Dieses Sicherheitsupdate schützt die Anmeldung, große Dateiimporte und den Update-Prozess. Wegen des Wechsels des Update-Signierschlüssels muss eine bestehende Webhosting-Installation einmal manuell auf 0.9.2 aktualisiert werden; danach funktionieren signierte Updates wieder in der Anwendung.

### Wichtigste Änderungen

- Fehlgeschlagene Anmeldungen werden auch bei gleichzeitigen Versuchen zuverlässig gezählt und begrenzt.
- Große Archivimporte werden erst nach Anmeldung und Administratorprüfung angenommen. Gewöhnliche Anfragen haben ein kleineres Größenlimit.
- Der Docker-Updater verwirft wiederholte und ältere signierte Releases und speichert seinen Versionsstand außerhalb des gemeinsam beschreibbaren Volumes.
- Release-Tags erhalten keinen Signierschlüssel mehr. Das Manifest wird erst nach Prüfung durch den geschützten Veröffentlichungsworkflow signiert.
- Der bisherige Update-Signierschlüssel wurde ersetzt. Bestehende Webhosting-Installationen benötigen einmalig das manuelle Update nach `docs/INSTALL-WEBHOSTING.md`.

## [0.9.1] - 2026-10-06

Öffentliche Projektfreigaben lassen sich zentral verwalten und nach Projektstatus einschränken. Die Freigabeansicht ist kompakter; gemeinsame, kleinere Eckenradien vereinheitlichen die Oberfläche.

### Wichtigste Änderungen

- Unter „Projekte → Freigaben“ lassen sich alle öffentlichen Freigaben zentral ansehen, bei gleichbleibendem Link bearbeiten, deaktivieren oder endgültig löschen. Name, Ablaufdatum und Statusauswahl sind änderbar; abgelaufene und deaktivierte Freigaben bleiben verwaltbar.
- Ordnerfreigaben sind über „Freigeben …“ im Drei-Punkte-Menü des jeweiligen Ordners erreichbar. Pro Link können alle regulären Projektstatus oder mehrere ausgewählte Status freigegeben werden; die Auswahl gilt auch für Unterordner und neue Projekte. Bestehende Links bleiben unverändert.
- Öffentliche Freigabeseiten verzichten auf technische Hinweise und Projektzähler. Der kompakte Titel vereint Ordnernamen und anklickbaren Pfad; ein Ablaufhinweis erscheint nur bei gesetztem Enddatum.
- Ein Sortiersymbol in der Titelzeile öffnet die Sortieroptionen. Ordner bleiben vor den Projekten und werden separat alphabetisch auf- oder absteigend sortiert.
- Logbuch, öffentliche Freigaben und Installation verwenden zentrale, reduzierte Eckenradien: 9 px für große Rahmen und Dialoge, 7 px für Inhaltsboxen, 6 px für Menüs und Standardfelder sowie 4 px für kompakte Bedienelemente. Runde Anzeigen und Druckmaße bleiben unverändert.

### Technik und Kompatibilität

- Datenbankschema 23 ergänzt die Statusauswahl von Ordnerfreigaben. Vollbackups sichern diese Auswahl; ältere Backups und bestehende Freigaben ohne Statusfilter bleiben kompatibel.

## [0.9.0] - 2026-10-06

Eine neue horizontale Navigation und die Projekt-Spaltenansicht vereinheitlichen die Bedienung. Erscheinungsbild, Einstellungen und Lageransichten wurden weiter verfeinert.

### Wichtigste Änderungen

- Die Hauptnavigation sitzt oben rechts statt in einer Seitenleiste. Untermenüs öffnen beim Darüberfahren; die globale Suche ist über die Lupe ganz rechts erreichbar. Kleine Bildschirme erhalten ein kompaktes Menü.
- Projekte werden in einer Ordner-Spaltenansicht mit Vorschau, Status, Fälligkeit und Markierung dargestellt. Ein Doppelklick oder die Lupe öffnet das vollständige Projekt.
- Die Statussortierung zeigt zuerst Ordner, dann Ideen, aktive, pausierte und abgeschlossene Projekte. Über das Augensymbol lassen sich sichtbare Status frei kombinieren und dauerhaft speichern.
- Projekte und Ordner lassen sich per Ziehen oder über „Verschieben …“ umordnen. Das Plus einer Spalte legt Projekte und Unterordner direkt am passenden Ort an.
- Die Einstellungsbereiche stehen in einer linken Navigationsspalte statt im Hauptmenü-Dropdown; auf kleinen Bildschirmen ist die Bereichsleiste horizontal scrollbar.
- Das Seitenlayout ist auf 1600 Pixel begrenzt und zentriert. Die Spaltenansichten für Projekte, Lagerorte und Kategorien haben wieder einen abgerundeten Rahmen, durchgehende Kopfzeilen und klare Trennlinien.
- Ein optionales Symbol aus der Iconbibliothek kann vor dem Namen und als Favicon verwendet werden. Das Favicon übernimmt die Oberflächenfarben; ohne ausgewähltes Symbol zeigt es den Projektwürfel.
- Artikel lassen sich in den Spaltenansichten von Lagerorten und Kategorien per Doppelklick vollständig öffnen. Der einfache Klick zeigt weiterhin die Vorschau.
- Optionale Feldhinweise stehen direkt hinter der Beschriftung, damit Eingabefelder bündig bleiben. Logo-Schriftzüge und Vorschauen schneiden Unterlängen wie beim „g“ nicht mehr ab.
- Das Entfernen eines eigenen Logos funktioniert nach Bestätigung wieder zuverlässig. Hauptmenü, Untermenüs und Suche verwenden einheitliche Hover-Farben.

### Weitere Details

- „Projekte“ öffnet direkt die Ordnerstruktur; sein Untermenü enthält Archiv und Papierkorb. Die zusätzliche Ansicht „Alle Projekte“ entfällt.
- „Lager“ öffnet direkt die Lagerort-Übersicht. Im Untermenü stehen Artikel, Kategorien, Nachbestellen, Inventur und Archiv.
- Auf Touch-Geräten öffnet das erste Tippen ein Hauptmenü-Untermenü, das zweite folgt dem Direktlink. Die Dropdowns öffnen linksbündig nach rechts; eine unsichtbare Brücke hält sie beim Überqueren des Abstands offen. Beim Verlassen schließen sie ohne Zeitverzögerung.
- Die Symbolauswahl kann über „Kein Symbol“ zurückgesetzt werden. Ein hochgeladenes Bildlogo hat im Menü Vorrang; das gewählte Symbol bleibt für das Favicon erhalten. Die Favicon-Farben gelten auch auf der Anmeldeseite und in öffentlichen Projektfreigaben.
- Das Entfernen eines Logos gibt auch eine eventuell offene lokale Bildvorschau frei. Fehler beim Entfernen werden angezeigt und erlauben einen erneuten Versuch.

## [0.8.2] - 2026-10-06

Die Update-Prüfung verarbeitet die kompakten Änderungsinformationen veröffentlichter Versionen wieder zuverlässig.

### Wichtigste Änderungen

- Der Release-Prozess begrenzt die kompakte Update-Zusammenfassung automatisch auf zehn Punkte und verhindert zu lange Einträge, bevor ein ungültiges Manifest veröffentlicht werden kann.

## [0.8.1] - 2026-10-06

Das Logbuch unterstützt nun öffentliche Projektübersichten und ergänzt die Lagerverwaltung um Inventuren, gemeinsame Stapelaktionen sowie frei konfigurierbare QR-Etiketten.

### Wichtigste Änderungen

- Projektansichten können als dynamische, öffentliche Übersicht ohne Anmeldung freigegeben werden. Statusansichten, die gesamte reguläre Projektliste oder komplette Ordnerunterbäume zeigen ausschließlich Projektname, Beschreibung, Status und Fälligkeit in einer sortierbaren Liste; Freigabelinks lassen sich befristen, erneuern und sofort widerrufen.
- Artikel können in der Artikelliste und in geöffneten Kategorien gemeinsam ausgewählt werden, um Kategorien zu ergänzen oder zu entfernen, globale Mindestbestände zu pflegen, Inventuren vorzumerken und Etiketten zu drucken.
- Mehrere Lagerpositionen eines Lagerorts lassen sich vollständig in einen anderen Lagerort verschieben oder mit einem gemeinsamen lokalen Mindestbestand versehen; Umlagerungen bleiben in der Buchungshistorie nachvollziehbar.
- CSV-Importe werden mit Datei, Zielort und Artikeln protokolliert. Neu importierte Lagerpositionen sind direkt ausgewählt und unveränderte Importe können nach einer Konfliktprüfung vollständig zurückgenommen werden.
- Inventurläufe lassen sich auf einzelne Lagerorte oder Unterbäume sowie eine oder mehrere Kategorien einschließlich Unterkategorien begrenzen. Bestandsprüfungen, Abweichungen und daraus erzeugte Korrekturbuchungen bleiben nachvollziehbar.
- Artikel und konkrete Lagerpositionen können mit Vermerk, Termin und normaler oder dringender Priorität zur Inventur vorgemerkt werden. Eine eigene Ansicht bündelt dringende, vorgemerkte und lange unangetastete Bestände.
- Lose Sammlungen erhalten passende Inventurzustände ohne Mengenerfassung.
- Aus den dauerhaften Links von Artikeln, Lagerorten und Kategorien lassen sich direkt QR-Codes und druckbare Etiketten erzeugen.
- Einzelne QR-Codes können offline als SVG oder PNG heruntergeladen werden; die QR-Daten werden dabei ausschließlich lokal im Browser erzeugt.
- Für einen Lagerort kann ein vollständiger Etikettenbogen seiner direkt enthaltenen Artikel oder aller Artikel im Unterbaum gedruckt beziehungsweise als PDF gespeichert werden.
- Neben A4-Bögen unterstützt die Druckausgabe jetzt Rollenetiketten für beliebige systemseitig installierte DYMO-, Brother-, Zebra- und andere Etikettendrucker. Jede Druckseite entspricht dabei exakt der frei eingestellten Etikettengröße.
- Eigene Etikettenprofile speichern Maße, Innenabstand, Druckkalibrierung, Rahmen, Informationsumfang und ein automatisches oder festes Hoch-/Querformat-Layout als persönliche Einstellung.
- Zu kleine Etiketten reduzieren weniger wichtige Informationen automatisch und warnen, wenn die verbleibende QR-Code-Fläche möglicherweise nicht zuverlässig scannt.

## [0.8.0] - 2026-09-04

Das Logbuch lässt sich erstmals vollständig an die eigene Werkstatt anpassen und unterstützt den schnellen Aufbau größerer, dauerhaft verlinkbarer Lagerbestände.

### Wichtigste Änderungen

- Artikel lassen sich über das Plus-Menü eines geöffneten Lagerorts gesammelt aus einer festen CSV-Vorlage importieren; Lagerort, Anfangsbestand, Mindestbestände und Stammdaten werden dabei gemeinsam angelegt.
- Vor dem Speichern zeigt eine validierte Vorschau alle Artikel und mögliche Dublettenhinweise. Der eigentliche Import speichert Artikel, Lagerplätze, Anfangsbuchungen und Kategoriezuordnungen atomar.
- Für alle importierten Artikel können mehrere vorhandene Kategorien ausgewählt und direkt im Importdialog weitere Kategorien angelegt werden.
- Jeder Artikel, Lagerort und jede Kategorie bietet nun einen dauerhaften, ID-basierten Link zum Kopieren. Die Links eignen sich für NFC-Tags und QR-Codes und bleiben auch nach Umbenennen oder Verschieben unverändert.
- Administratoren können das sichtbare Erscheinungsbild der Instanz mit frei wählbarer Akzentfarbe, Anzeigename, Untertitel und eigenem Bildlogo gestalten. Hex-Eingabe, Farbfeld und RGB-Regler bleiben dabei synchron; passende helle Akzent- und Kontrastfarben werden automatisch berechnet.
- Das Erscheinungsbild gilt bereits auf der Anmeldeseite für alle Benutzer. Ein eigenes Logo wird zusammen mit den übrigen Einstellungen im vollständigen Backup gesichert und wiederhergestellt, während der interne Produktname „Logbuch“ unverändert bleibt.
- Das Erscheinungsbild bietet jetzt einen hellen, einen dunklen und einen automatischen Modus. Die Automatik folgt der Systemeinstellung des jeweiligen Geräts und reagiert auch auf Änderungen während der Nutzung.
- Oberflächen, Eingabefelder und Dialoge verwenden gemeinsame semantische Farbvariablen. Fehler, Warnungen, Erfolge und Informationen bleiben unterscheidbar, werden aber in Helligkeit und Sättigung mit Akzentfarbe und Darstellungsmodus harmonisiert; Druck- und PDF-Ausgaben bleiben papiergerecht hell.

## [0.7.4] - 2026-09-03

Die Bedienoberfläche folgt nun durchgängigeren Regeln; besonders die Lager- und Kategorienansichten nutzen den verfügbaren Arbeitsraum klarer und direkter.

### Wichtigste Änderungen

- Die Spaltenansichten für Lagerorte und Kategorien reichen auf großen Bildschirmen vom Seitenkopf bis an die verbleibenden Browserränder; einheitliche Kopfzeilen und die erhaltene Pfadleiste strukturieren den randlosen Arbeitsbereich.
- Beim Öffnen eines Artikels scrollt die Spaltenansicht dessen Vorschau vollständig ins Bild. Eine Lupe führt zur vollständigen Artikelansicht, in der „Bearbeiten“ nun direkt erreichbar ist.
- Aktionsmenüs, Filterzustände, Seitenköpfe, Archivbezeichnungen und optionale Feldhinweise wurden über vergleichbare Ansichten hinweg vereinheitlicht.
- Kritische Aktionen verwenden einen gemeinsamen Logbuch-Bestätigungsdialog statt uneinheitlicher Browserabfragen.
- Zahlenfelder verwenden konsistente große Minus-/Plus-Schaltflächen, unter anderem bei Beständen, Reservierungsentnahmen und wiederkehrenden Erinnerungen.

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

[Unveröffentlicht]: https://github.com/johannesboernsen/logbuch/compare/v0.7.4...HEAD
[0.7.4]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.7.4
[0.7.3]: https://github.com/johannesboernsen/logbuch/releases/tag/v0.7.3
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
