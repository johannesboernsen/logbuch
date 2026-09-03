ALTER TABLE inventory_items ADD COLUMN tracking_mode TEXT NOT NULL DEFAULT 'QUANTITY'
    CHECK (tracking_mode IN ('QUANTITY', 'COLLECTION'));

CREATE INDEX IF NOT EXISTS inventory_items_tracking_status_name
    ON inventory_items(tracking_mode, status, name);
