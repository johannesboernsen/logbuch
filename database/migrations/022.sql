CREATE TABLE IF NOT EXISTS project_public_shares (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE
        CHECK (length(token) = 64 AND token NOT GLOB '*[^a-f0-9]*'),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
    scope_type TEXT NOT NULL CHECK (scope_type IN ('ALL', 'STATUS', 'FOLDER')),
    project_status TEXT NOT NULL DEFAULT '',
    folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT '',
    CHECK (
        (scope_type = 'ALL' AND project_status = '' AND folder_id IS NULL)
        OR (scope_type = 'STATUS' AND project_status IN ('idea', 'active', 'paused', 'completed') AND folder_id IS NULL)
        OR (scope_type = 'FOLDER' AND project_status = '' AND folder_id IS NOT NULL)
    ),
    CHECK (expires_at = '' OR expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

CREATE INDEX IF NOT EXISTS project_public_shares_active_created
    ON project_public_shares(active, created_at DESC);
