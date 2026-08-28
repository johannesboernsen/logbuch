CREATE TABLE IF NOT EXISTS storage_locations (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES storage_locations(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
    type TEXT NOT NULL DEFAULT 'OTHER' CHECK (type IN (
        'ROOM', 'AREA', 'SHELF', 'CABINET', 'COMPARTMENT', 'DRAWER',
        'BOX', 'BAG', 'CAN', 'CONTAINER', 'OTHER'
    )),
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS storage_locations_parent_status
    ON storage_locations(parent_id, status);
CREATE INDEX IF NOT EXISTS storage_locations_status_name
    ON storage_locations(status, name);

CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
    description TEXT NOT NULL DEFAULT '',
    stock_unit TEXT NOT NULL CHECK (length(trim(stock_unit)) BETWEEN 1 AND 40),
    manufacturer TEXT NOT NULL DEFAULT '',
    article_number TEXT NOT NULL DEFAULT '',
    barcode TEXT NOT NULL DEFAULT '',
    merchant_url TEXT NOT NULL DEFAULT '',
    default_minimum_quantity NUMERIC
        CHECK (default_minimum_quantity IS NULL OR default_minimum_quantity >= 0),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS inventory_items_status_name
    ON inventory_items(status, name);
CREATE INDEX IF NOT EXISTS inventory_items_article_number
    ON inventory_items(article_number) WHERE article_number <> '';
CREATE INDEX IF NOT EXISTS inventory_items_barcode
    ON inventory_items(barcode) WHERE barcode <> '';

CREATE TABLE IF NOT EXISTS stock_entries (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    storage_location_id TEXT NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
    quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    minimum_quantity NUMERIC CHECK (minimum_quantity IS NULL OR minimum_quantity >= 0),
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (item_id, storage_location_id)
);

CREATE INDEX IF NOT EXISTS stock_entries_location_status
    ON stock_entries(storage_location_id, status);
CREATE INDEX IF NOT EXISTS stock_entries_item_status
    ON stock_entries(item_id, status);

CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    project_id TEXT NOT NULL CHECK (length(trim(project_id)) BETWEEN 3 AND 64),
    project_entry_collection TEXT,
    project_entry_id TEXT,
    requested_quantity NUMERIC NOT NULL CHECK (requested_quantity > 0),
    fulfilled_quantity NUMERIC NOT NULL DEFAULT 0
        CHECK (fulfilled_quantity >= 0 AND fulfilled_quantity <= requested_quantity),
    status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'FULFILLED', 'RELEASED', 'CANCELLED')),
    note TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT,
    CHECK (
        (project_entry_collection IS NULL AND project_entry_id IS NULL)
        OR
        (project_entry_collection IS NOT NULL
         AND project_entry_id IS NOT NULL
         AND length(trim(project_entry_collection)) BETWEEN 1 AND 40
         AND length(trim(project_entry_id)) BETWEEN 3 AND 64)
    ),
    CHECK (status <> 'FULFILLED' OR fulfilled_quantity = requested_quantity),
    CHECK (status <> 'ACTIVE' OR fulfilled_quantity < requested_quantity)
);

CREATE INDEX IF NOT EXISTS reservations_item_status
    ON reservations(item_id, status);
CREATE INDEX IF NOT EXISTS reservations_project_status
    ON reservations(project_id, status);
CREATE INDEX IF NOT EXISTS reservations_project_entry
    ON reservations(project_id, project_entry_collection, project_entry_id)
    WHERE project_entry_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stock_transactions (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    type TEXT NOT NULL CHECK (type IN (
        'RECEIPT', 'CONSUMPTION', 'TRANSFER', 'RETURN',
        'CORRECTION', 'DISPOSAL', 'LOSS'
    )),
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    source_storage_location_id TEXT REFERENCES storage_locations(id) ON DELETE RESTRICT,
    destination_storage_location_id TEXT REFERENCES storage_locations(id) ON DELETE RESTRICT,
    reservation_id TEXT REFERENCES reservations(id) ON DELETE RESTRICT,
    reversal_of_transaction_id TEXT REFERENCES stock_transactions(id) ON DELETE RESTRICT,
    note TEXT NOT NULL DEFAULT '',
    recorded_by TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (
        (type IN ('RECEIPT', 'RETURN')
         AND source_storage_location_id IS NULL
         AND destination_storage_location_id IS NOT NULL)
        OR
        (type IN ('CONSUMPTION', 'DISPOSAL', 'LOSS')
         AND source_storage_location_id IS NOT NULL
         AND destination_storage_location_id IS NULL)
        OR
        (type = 'TRANSFER'
         AND source_storage_location_id IS NOT NULL
         AND destination_storage_location_id IS NOT NULL
         AND source_storage_location_id <> destination_storage_location_id)
        OR
        (type = 'CORRECTION'
         AND ((source_storage_location_id IS NULL) <> (destination_storage_location_id IS NULL)))
    ),
    CHECK (reversal_of_transaction_id IS NULL OR reversal_of_transaction_id <> id)
);

CREATE INDEX IF NOT EXISTS stock_transactions_item_occurred
    ON stock_transactions(item_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS stock_transactions_source_occurred
    ON stock_transactions(source_storage_location_id, occurred_at DESC)
    WHERE source_storage_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_transactions_destination_occurred
    ON stock_transactions(destination_storage_location_id, occurred_at DESC)
    WHERE destination_storage_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_transactions_reservation
    ON stock_transactions(reservation_id) WHERE reservation_id IS NOT NULL;
