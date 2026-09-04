# Lagerdomäne und Persistenzregeln

Dieses Dokument hält die Persistenzentscheidungen aus Phase 1 fest. Der Lagerbereich ist eine globale, transaktionale Domäne und liegt deshalb in SQLite. Die bestehenden Projekte und ihre Sammlungen bleiben als offene JSON-/Markdown-Daten im Projektordner gespeichert.

## Kernmodelle

- `storage_locations` bildet einen beliebig tiefen Baum. Typen dienen nur der Darstellung und schränken die Hierarchie nicht ein. IDs sind stabil und unabhängig von Name und Pfad.
- `inventory_items` beschreibt einen Artikel unabhängig von Ort und Bestand. `stock_unit` ist die einzige Basiseinheit des Artikels; Einheitenumrechnungen und Chargen sind nicht Bestandteil dieses Modells.
- `stock_entries` enthält den physischen Bestand eines Artikels an genau einem Lagerort. Die Kombination aus Artikel und Lagerort ist eindeutig. Ein Eintrag mit Menge null darf nach einer Entnahme bestehen bleiben, kann aber bewusst gelöscht werden.
- `stock_transactions` ist die unveränderliche Historie physischer Änderungen. `quantity` ist stets ein positiver Betrag; Quelle und Ziel bestimmen die Richtung. Eine positive Korrektur hat nur ein Ziel, eine negative Korrektur nur eine Quelle.
- `reservations` bindet eine angeforderte Artikelmenge an ein Projekt oder optional an ein konkretes Projektelement. `fulfilled_quantity` wird gespeichert, damit Teilerfüllungen und der Lebenszyklus nachvollziehbar bleiben.

Neue IDs werden im Anwendungscode mit dem vorhandenen kryptografischen `randomId()` und einem fachlichen Präfix erzeugt (`location-`, `item-`, `stock-`, `transaction-`, `reservation-`). Sie enthalten weder Namen noch Lagerpfade und bleiben bei Umbenennung, Verschiebung und Archivierung unverändert.

## Projekt- und Projektelement-Verweise

`ProjectStore` speichert Projekte und ihre Einträge nicht in SQLite. Daher können `reservations.project_id`, `project_entry_collection` und `project_entry_id` keine echten SQLite-Foreign-Keys besitzen. Sie übernehmen die opaken, stabilen IDs aus `ProjectStore`.

Der Domain-Layer muss beim Anlegen oder Ändern einer Reservierung prüfen:

1. Das Projekt existiert und ist für den handelnden Benutzer zugänglich.
2. Wenn ein Projektelement angegeben ist, sind Collection und ID gemeinsam gesetzt und das Element gehört zum Projekt.
3. Neue Reservierungen dürfen nicht auf archivierte Artikel zeigen.

Historische Reservierungen behalten ihre IDs auch dann, wenn ein Projektelement später entfernt wird. Die UI muss solche Verweise als historisch bzw. nicht mehr auflösbar darstellen.

## In SQLite erzwungene Regeln

- Foreign Keys auf Artikel, Lagerorte, Reservierungen und Gegenbuchungen verwenden `ON DELETE RESTRICT`.
- Artikel und Lagerorte werden über `ACTIVE`/`ARCHIVED` archiviert. Leere Bestandseinträge dürfen gelöscht werden, weil die unveränderliche Bewegungshistorie unabhängig von ihnen auf Artikel und Lagerorte verweist.
- Physische Mengen und Mindestbestände sind nichtnegativ.
- Pro Artikel und Lagerort existiert höchstens ein Bestandseintrag.
- Reservierungsmengen sind positiv, Erfüllungsmengen liegen zwischen null und Anforderung und `FULFILLED` bedeutet vollständig erfüllt.
- Eine Bewegung besitzt einen positiven Betrag und eine zum Bewegungstyp passende Quelle-/Ziel-Kombination.
- Eine Umlagerung kann nicht denselben Quell- und Zielort besitzen.
- Indizes decken Baum-Navigation, Artikel-/Ortsbestände, aktive Reservierungen, Projektverweise und die Bewegungshistorie ab.

## Im Domain-/Service-Layer zu erzwingende Regeln

- Vor dem Ändern von `parent_id` wird geprüft, dass kein Lagerort unter sich selbst oder einen Nachfahren verschoben wird. Der DB-Check verhindert nur die unmittelbare Selbstreferenz.
- Lagerorte werden über `sort_order` innerhalb ihres jeweiligen Parents stabil sortiert. Beim Umplatzieren bleibt die Identität des gesamten Unterbaums unverändert; der verschobene Wurzelort wird am Ende der neuen Geschwister einsortiert.
- Jeder Lagerort besitzt ein validiertes Lucide-Icon. Bestehende Orte erhalten `archive` als Standard; das Icon bleibt beim Umplatzieren, Archivieren und Wiederherstellen erhalten. Ein separater Lagerort-Typ wird nicht geführt, weil er weder Hierarchie noch Verhalten beeinflusst.
- Archivieren wirkt auf den vollständigen Unterbaum. Die Datensätze und alle Foreign-Key-Referenzen bleiben bestehen; reguläre Listen blenden archivierte Orte aus. Wiederherstellen ist nur unter einem aktiven Parent möglich und reaktiviert ebenfalls den Unterbaum.
- Die Lageroberfläche rekonstruiert aus der stabilen Route `/#/inventory/location/:id` den vollständigen Parent-Pfad. Jede Finder-Spalte zeigt zuerst die direkten Unterorte und danach die direkt an diesem Lagerort geführten Bestandseinträge. Eine Auswahl bleibt an ihrer sortierten Position; rechts davon erscheint der Inhalt des markierten Lagerorts.
- Ein Artikel innerhalb eines Lagerorts wird über `/#/inventory/location/:locationId/item/:itemId` kontextgebunden geöffnet. Die rechte Detailspalte zeigt den lokalen Bestand sowie die globalen Artikelwerte und weitere Lagerorte desselben Artikels. Damit bleibt derselbe Artikel an mehreren Orten eindeutig; auf kleinen Bildschirmen wird die Detailspalte als nächste Drill-down-Ebene mit Zurücknavigation gerendert.
- Artikel werden in Phase 4 über `/#/inventory/items` und die stabile Detailroute `/#/inventory/item/:id` unabhängig von Lagerort und Bestand verwaltet. Reguläre Listen und die Suche blenden archivierte Artikel aus; direkte historische Links bleiben auflösbar. Die Bestandseinheit ist frei benennbar, für `Stück` sind Mindestbestände jedoch ganzzahlig. Händlerlinks akzeptieren ausschließlich HTTP(S)-Adressen.
- Phase 5 verbindet Artikel und Lagerorte über eindeutige Bestandseinträge. Eine positive Anfangsmenge erzeugt eine `RECEIPT`-Bewegung; spätere Mengenänderungen sind ausschließlich über Zugang, Rückgabe, Verbrauch, Entsorgung, Verlust, Korrektur oder atomare Umlagerung möglich. Fehlgeschlagene Entnahmen und Umlagerungen ändern weder Quelle noch Ziel noch Historie. Bestandseinträge mit Menge null bleiben nach Verbrauch, Korrektur, Entsorgung oder Verlust zunächst aktiv, damit der Lagerplatz weiterverwendet werden kann. Sie können danach bewusst gelöscht werden; Einträge mit positiver Menge nicht. Verbuchte Bewegungen besitzen keine Änderungs- oder Löschroute.
- Phase 6 verbindet Artikelbedarf bidirektional mit Projekten und optional deren Arbeitsschritten. Neue Reservierungen dürfen nur auf vorhandene, zugängliche und nicht abgeschlossene oder archivierte Projekte sowie aktive Artikel zeigen. Historische Verweise bleiben auch dann lesbar, wenn ihr dateibasiertes Projektziel später nicht mehr auflösbar ist.
- Aktive Reservierungen dürfen den physischen Bestand überschreiten. Sie ändern ihn beim Anlegen oder Bearbeiten nicht. `reservedQuantity` summiert ausschließlich den noch offenen Anteil aktiver Reservierungen. Die Oberfläche kennt nur noch das Aufheben einer Reservierung; ältere freigegebene oder stornierte Datensätze werden dabei gleichbehandelt. Geschlossene und erfüllte Reservierungen erscheinen nicht mehr in den Reservierungslisten, bleiben aber für die gemeinsame Artikelhistorie erhalten und zählen nicht mehr als gebundener Bedarf.
- Eine Reservierung wird über eine verknüpfte `CONSUMPTION`-Buchung teilweise oder vollständig erfüllt. Physischer Quellbestand, `fulfilled_quantity`, Reservierungsstatus, `closed_at` und `stock_transactions.reservation_id` werden atomar aktualisiert. Scheitert eine Teiloperation, bleibt der gesamte Vorgang unverändert.
- Die Lageransicht berechnet `availableQuantity = physicalQuantity - reservedQuantity` und `reorderQuantity = max(defaultMinimumQuantity - availableQuantity, 0)`. Verfügbarkeit darf negativ sein; physischer Bestand weiterhin nicht.
- Phase 7 ergänzt unter `/#/inventory/replenishment` eine zentrale, aus dem aktuellen Bestand abgeleitete Fehlbedarfsansicht. Sie speichert weder Einkaufslisten noch Bestellungen und zeigt standardmäßig nur aktive Artikel mit positivem Nachbestellbedarf; Suche, Sortierung und eine Vollansicht aller aktiven Artikel sind reine Abfrageparameter.
- Der globale Bedarf ist `max((defaultMinimumQuantity oder 0) - availableQuantity, 0)`. Damit bleibt ein nicht gedeckter Projektbedarf auch bei einem Artikel ohne globalen Mindestbestand sichtbar. Der lokale Bedarf ist die Summe der Unterschreitungen aktiver Bestandseinträge an aktiven Lagerorten.
- Der Bestellvorschlag eines Artikels ist `max(globalReorderQuantity, localReorderQuantity)`. Globale und lokale Mindestwerte werden nicht addiert, weil dieselbe Nachlieferung beide Anforderungen decken kann. Projektfehlbedarf ist der gesondert ausgewiesene Anteil `max(-availableQuantity, 0)`; Summen werden wegen unterschiedlicher Bestandseinheiten nur je Einheit gebildet.
- Archivierte Artikel erscheinen nicht in der Nachbestellansicht. Bestand an archivierten Lagerorten bleibt als physischer, historisch referenzierter Bestand erhalten, erzeugt dort aber keinen neuen lokalen Auffüllvorschlag.
- Jede Änderung von `stock_entries.quantity` wird zusammen mit genau einer passenden `stock_transaction` in derselben SQLite-Transaktion ausgeführt.
- Verbuchte Bestandsbewegungen werden vom Store weder geändert noch gelöscht. Fehler werden durch eine neue Korrektur- oder Gegenbuchung mit `reversal_of_transaction_id` berichtigt. Die bestehende Migrationssicherung verbietet SQL-Triggerblöcke; deshalb liegt diese Unveränderlichkeitsregel im Domain-Layer.
- Eine Umlagerung aktualisiert Quell- und Zielbestand und schreibt die `TRANSFER`-Bewegung atomar. Sie erzeugt einen fehlenden Ziel-Bestandseintrag bei Bedarf oder reaktiviert einen dort historisch archivierten Eintrag. Wird die vollständige Quellmenge verschoben, wird der leere Quelleintrag in derselben Transaktion gelöscht; bei einer Teilmenge bleibt er aktiv. Lokaler Mindestbestand und Notiz werden nicht zum Ziel kopiert und gehen beim Löschen der leeren Quelle verloren. Die Umlagerung bleibt über Artikel sowie Quell- und Ziellagerort vollständig in der Historie erhalten.
- Mengen in der Einheit `Stück` müssen ganzzahlig sein. Für andere Einheiten legt der Domain-Layer eine einheitliche Dezimalpräzision fest.
- Archivierte Artikel und Lagerorte bleiben lesbar, dürfen aber nicht für neue Bestände, Bewegungen oder Reservierungen verwendet werden.
- Store/API archivieren Lagerorte und Artikel weiterhin, damit Hierarchie und historische Referenzen intakt bleiben. Eine Artikel-Lagerort-Zuordnung darf dagegen nur bei Menge null endgültig gelöscht werden; ihre Bewegungen bleiben erhalten, weil sie nicht auf den Bestandseintrag verweisen.
- Reservierungen verändern den physischen Bestand nicht. Aktive Reservierungen dürfen den Bestand überschreiten.
- `reservedQuantity` ist die Summe aus `requested_quantity - fulfilled_quantity` aller aktiven Reservierungen. `availableQuantity` und Nachbestellbedarf werden daraus berechnet und nicht gespeichert.
- Statuswechsel von Reservierungen, `closed_at` und verknüpfte Verbrauchsbuchungen werden konsistent in einer Transaktion gepflegt.
- Eine Gegenbuchung muss denselben Artikel wie die referenzierte ursprüngliche Bewegung verwenden und darf nur einmal als vollständige Gegenbuchung gelten.
- Zugriffsrechte sowie die Existenz dateibasierter Projekt-/Projektelement-Verweise werden über `ProjectStore` geprüft.

## Noch nicht Teil von Phase 1

Attachments und die bestehenden Projekt-Notizen sind an Projektverzeichnisse und Projekt-Collections gebunden. Die Lagerkerntabellen besitzen deshalb vorerst Beschreibungs-/Notizfelder, aber noch keine unechte Wiederverwendung des Projekt-Attachment-Formats. Ein globales Attachment-/Notizmodell für Lagerorte, Artikel und Bestandseinträge wird zusammen mit den zugehörigen Schreib- und Backup-Flows ergänzt.

Artikel, Lagerorte und Kategorien besitzen inzwischen dauerhafte, ID-basierte Links. Sie können als Ziel für QR-Codes und NFC-Tags verwendet werden und bleiben beim Umbenennen oder Verschieben unverändert.

Weiterhin offen bleiben direkt erzeugte QR-Etiketten, Tags, benutzerdefinierte Eigenschaften, Inventur, ein tatsächlicher Einkaufs-/Bestellprozess sowie globale Lager-Anhänge und -Notizen.
