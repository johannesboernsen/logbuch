CREATE TABLE IF NOT EXISTS inventory_item_notes (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 10000),
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS inventory_item_notes_item_created
    ON inventory_item_notes(item_id, created_at DESC, id DESC);
