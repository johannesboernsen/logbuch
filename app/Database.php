<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class Database
{
    private PDO $pdo;
    private string $path;

    public function __construct(string $path)
    {
        $this->path = $path;
        $directory = dirname($path);
        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
            throw new \RuntimeException('Das Speicherverzeichnis konnte nicht angelegt werden.');
        }

        $this->pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_TIMEOUT => 5,
        ]);
        $this->pdo->exec('PRAGMA busy_timeout = 5000');
        $this->pdo->exec('PRAGMA foreign_keys = ON');
        $this->pdo->exec('PRAGMA synchronous = NORMAL');
        if (!$this->schemaReady()) {
            $this->migrateWithLock();
        }
        @chmod($path, 0660);
    }

    public function pdo(): PDO
    {
        return $this->pdo;
    }

    public function transaction(callable $callback): mixed
    {
        $this->pdo->beginTransaction();
        try {
            $result = $callback($this->pdo);
            $this->pdo->commit();
            return $result;
        } catch (\Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }
    }

    private function schemaReady(): bool
    {
        try {
            $statement = $this->pdo->query("SELECT value FROM meta WHERE key = 'schema_version'");
            return (int) $statement->fetchColumn() === \logbuch_schema_version();
        } catch (\PDOException) {
            return false;
        }
    }

    private function migrateWithLock(): void
    {
        $lockPath = $this->path . '.migrate.lock';
        $lock = fopen($lockPath, 'c');
        if ($lock === false || !flock($lock, LOCK_EX)) {
            throw new \RuntimeException('Die Datenbankmigration konnte nicht gesperrt werden.');
        }
        try {
            if ($this->schemaReady()) {
                return;
            }
            $this->pdo->exec('PRAGMA journal_mode = WAL');
            $this->migrate();
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
            @chmod($lockPath, 0660);
        }
    }

    private function migrate(): void
    {
        $previousVersion = 0;
        try {
            $previousVersion = (int) ($this->pdo->query("SELECT value FROM meta WHERE key = 'schema_version'")->fetchColumn() ?: 0);
        } catch (\PDOException) {
        }
        $this->pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
                active INTEGER NOT NULL DEFAULT 1,
                access_mode TEXT NOT NULL DEFAULT 'include' CHECK (access_mode IN ('include', 'exclude', 'all')),
                password_hash TEXT NOT NULL,
                must_change_password INTEGER NOT NULL DEFAULT 1,
                preferences_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                last_login_at TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS user_projects (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                project_id TEXT NOT NULL,
                PRIMARY KEY (user_id, project_id)
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                token_hash TEXT NOT NULL UNIQUE,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                touched_at INTEGER NOT NULL,
                ip TEXT NOT NULL DEFAULT '',
                user_agent TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS login_attempts (
                identity TEXT PRIMARY KEY,
                attempts INTEGER NOT NULL DEFAULT 0,
                blocked_until INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                occurred_at TEXT NOT NULL,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                target TEXT NOT NULL DEFAULT '',
                details TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                normalized_name TEXT NOT NULL UNIQUE,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                parent_id TEXT REFERENCES folders(id) ON DELETE RESTRICT,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                priority TEXT NOT NULL DEFAULT 'Mittel',
                flagged INTEGER NOT NULL DEFAULT 0,
                icon TEXT NOT NULL DEFAULT 'folder',
                tag_ids_json TEXT NOT NULL DEFAULT '[]',
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS folders_parent_id ON folders(parent_id);

            CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                completed_at TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS todos_user_state_order ON todos(user_id, completed_at, sort_order);
        SQL);

        $folderColumns = array_column($this->pdo->query('PRAGMA table_info(folders)')->fetchAll(), 'name');
        if (!in_array('priority', $folderColumns, true)) $this->pdo->exec("ALTER TABLE folders ADD COLUMN priority TEXT NOT NULL DEFAULT 'Mittel'");
        if (!in_array('flagged', $folderColumns, true)) $this->pdo->exec('ALTER TABLE folders ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0');
        if (!in_array('icon', $folderColumns, true)) $this->pdo->exec("ALTER TABLE folders ADD COLUMN icon TEXT NOT NULL DEFAULT 'folder'");
        if (!in_array('tag_ids_json', $folderColumns, true)) $this->pdo->exec("ALTER TABLE folders ADD COLUMN tag_ids_json TEXT NOT NULL DEFAULT '[]'");

        // Tags can no longer be disabled. Restore previously disabled tags so
        // they remain visible and selectable after the feature is removed.
        $this->pdo->exec('UPDATE tags SET active = 1 WHERE active <> 1');
        $this->pdo->exec("DELETE FROM settings WHERE key IN ('smtp', 'backup')");

        $targetVersion = \logbuch_schema_version();
        for ($version = max(7, $previousVersion + 1); $version <= $targetVersion; $version++) {
            $migrationPath = \logbuch_root_path() . '/database/migrations/' . sprintf('%03d.sql', $version);
            if (!is_file($migrationPath)) {
                throw new \RuntimeException('Die Datenbankmigration ' . $version . ' fehlt.');
            }
            $sql = (string) file_get_contents($migrationPath);
            if ($sql === '' || preg_match('/\b(?:ATTACH|DETACH|VACUUM|BEGIN|COMMIT|ROLLBACK)\b/i', $sql)) {
                throw new \RuntimeException('Die Datenbankmigration ' . $version . ' ist ungültig.');
            }
            // A container may temporarily run an older release against a newer
            // volume. Keep additive migrations repeatable when the newer column
            // is already present but the older release lowered schema_version.
            $todoColumns = array_column($this->pdo->query('PRAGMA table_info(todos)')->fetchAll(), 'name');
            if ($version === 8 && in_array('parent_id', $todoColumns, true)) {
                $sql = 'CREATE INDEX IF NOT EXISTS todos_user_parent_state_order ON todos(user_id, parent_id, completed_at, sort_order)';
            }
            if ($version === 9 && in_array('cleared_at', $todoColumns, true)) {
                $sql = 'CREATE INDEX IF NOT EXISTS todos_user_cleared_order ON todos(user_id, cleared_at, sort_order)';
            }
            if ($version === 10) {
                $statements = [];
                if (!in_array('repeat_interval', $todoColumns, true)) $statements[] = "ALTER TABLE todos ADD COLUMN repeat_interval INTEGER NOT NULL DEFAULT 0";
                if (!in_array('repeat_unit', $todoColumns, true)) $statements[] = "ALTER TABLE todos ADD COLUMN repeat_unit TEXT NOT NULL DEFAULT ''";
                if (!in_array('repeat_due_at', $todoColumns, true)) $statements[] = "ALTER TABLE todos ADD COLUMN repeat_due_at TEXT NOT NULL DEFAULT ''";
                $statements[] = 'CREATE INDEX IF NOT EXISTS todos_user_repeat_due ON todos(user_id, repeat_due_at)';
                $sql = implode(";\n", $statements);
            }
            if ($version === 11) {
                $statements = [];
                if (!in_array('repeat_waiting_at', $todoColumns, true)) $statements[] = "ALTER TABLE todos ADD COLUMN repeat_waiting_at TEXT NOT NULL DEFAULT ''";
                $statements[] = 'CREATE INDEX IF NOT EXISTS todos_user_repeat_waiting ON todos(user_id, repeat_waiting_at)';
                $sql = implode(";\n", $statements);
            }
            $this->pdo->beginTransaction();
            try {
                $this->pdo->exec($sql);
                $statement = $this->pdo->prepare('INSERT INTO meta (key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
                $statement->execute(['key' => 'schema_version', 'value' => (string) $version]);
                $this->pdo->commit();
            } catch (\Throwable $error) {
                if ($this->pdo->inTransaction()) $this->pdo->rollBack();
                throw $error;
            }
        }

        $statement = $this->pdo->prepare('INSERT INTO meta (key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
        $statement->execute(['key' => 'schema_version', 'value' => (string) $targetVersion]);
    }
}
