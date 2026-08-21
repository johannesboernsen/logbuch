# Datenbankmigrationen

Ab Schema 7 liegt hier für jede neue Schema-Version genau eine aufsteigend nummerierte SQL-Datei, beispielsweise `007.sql`. Der Updater führt fehlende Dateien innerhalb seiner Update-Transaktion aus; eine manuell aktualisierte Installation führt sie beim nächsten Start aus.

Migrationen enthalten keine eigenen Transaktionsbefehle und verwenden weder `ATTACH`, `DETACH` noch `VACUUM`.
