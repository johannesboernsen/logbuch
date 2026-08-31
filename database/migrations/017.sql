CREATE TABLE IF NOT EXISTS inventory_categories (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES inventory_categories(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
    description TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'folder'
        CHECK (length(icon) BETWEEN 1 AND 64 AND icon GLOB '[a-z0-9]*' AND icon NOT GLOB '*[^a-z0-9-]*'),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS inventory_categories_parent_sort
    ON inventory_categories(parent_id, sort_order, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS inventory_item_categories (
    item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES inventory_categories(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (item_id, category_id)
);

CREATE INDEX IF NOT EXISTS inventory_item_categories_category
    ON inventory_item_categories(category_id, item_id);
