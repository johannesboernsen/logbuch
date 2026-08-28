ALTER TABLE storage_locations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0);

CREATE INDEX IF NOT EXISTS storage_locations_parent_status_sort
    ON storage_locations(parent_id, status, sort_order, name COLLATE NOCASE);
