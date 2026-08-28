ALTER TABLE storage_locations
ADD COLUMN icon TEXT NOT NULL DEFAULT 'archive'
CHECK (
    length(icon) BETWEEN 1 AND 64
    AND icon GLOB '[a-z0-9]*'
    AND icon NOT GLOB '*[^a-z0-9-]*'
);
