CREATE TABLE IF NOT EXISTS inventory_audit_requests (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    stock_entry_id TEXT REFERENCES stock_entries(id) ON DELETE SET NULL,
    priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL', 'URGENT')),
    note TEXT NOT NULL DEFAULT '',
    due_at TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    resolved_by TEXT NOT NULL DEFAULT '',
    resolved_at TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_audit_requests_open_item
    ON inventory_audit_requests(item_id)
    WHERE stock_entry_id IS NULL AND status = 'OPEN';
CREATE UNIQUE INDEX IF NOT EXISTS inventory_audit_requests_open_entry
    ON inventory_audit_requests(stock_entry_id)
    WHERE stock_entry_id IS NOT NULL AND status = 'OPEN';
CREATE INDEX IF NOT EXISTS inventory_audit_requests_status_priority
    ON inventory_audit_requests(status, priority, due_at, created_at);

CREATE TABLE IF NOT EXISTS inventory_audits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETED', 'CANCELLED')),
    scope_json TEXT NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    completed_by TEXT NOT NULL DEFAULT '',
    completed_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS inventory_audits_status_created
    ON inventory_audits(status, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_audit_entries (
    id TEXT PRIMARY KEY,
    audit_id TEXT NOT NULL REFERENCES inventory_audits(id) ON DELETE RESTRICT,
    item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    stock_entry_id TEXT REFERENCES stock_entries(id) ON DELETE SET NULL,
    storage_location_id TEXT NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
    tracking_mode TEXT NOT NULL CHECK (tracking_mode IN ('QUANTITY', 'COLLECTION')),
    book_quantity NUMERIC,
    counted_quantity NUMERIC,
    result TEXT NOT NULL DEFAULT 'PENDING' CHECK (result IN ('PENDING', 'MATCH', 'CORRECTED', 'OPEN_DIFFERENCE', 'NOT_FOUND', 'OK', 'ATTENTION', 'SKIPPED')),
    note TEXT NOT NULL DEFAULT '',
    correction_transaction_id TEXT REFERENCES stock_transactions(id) ON DELETE RESTRICT,
    checked_by TEXT NOT NULL DEFAULT '',
    checked_at TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (audit_id, item_id, storage_location_id),
    CHECK ((tracking_mode = 'QUANTITY' AND book_quantity IS NOT NULL) OR (tracking_mode = 'COLLECTION' AND book_quantity IS NULL))
);

CREATE INDEX IF NOT EXISTS inventory_audit_entries_audit_result
    ON inventory_audit_entries(audit_id, result, sort_order);
CREATE INDEX IF NOT EXISTS inventory_audit_entries_item_checked
    ON inventory_audit_entries(item_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS inventory_audit_entries_location_checked
    ON inventory_audit_entries(storage_location_id, checked_at DESC);
