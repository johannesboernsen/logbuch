CREATE TABLE IF NOT EXISTS inventory_import_batches (
    id TEXT PRIMARY KEY,
    source_filename TEXT NOT NULL DEFAULT '',
    storage_location_id TEXT NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
    category_ids_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVERTED')),
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    reverted_by TEXT NOT NULL DEFAULT '',
    reverted_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS inventory_import_batches_location_created
    ON inventory_import_batches(storage_location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_import_batch_items (
    batch_id TEXT NOT NULL REFERENCES inventory_import_batches(id) ON DELETE CASCADE,
    item_id TEXT REFERENCES inventory_items(id) ON DELETE SET NULL,
    original_item_id TEXT NOT NULL,
    stock_entry_id TEXT,
    initial_transaction_id TEXT,
    row_number INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    PRIMARY KEY (batch_id, original_item_id)
);

CREATE INDEX IF NOT EXISTS inventory_import_batch_items_item
    ON inventory_import_batch_items(item_id) WHERE item_id IS NOT NULL;
