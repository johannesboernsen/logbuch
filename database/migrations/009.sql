ALTER TABLE todos ADD COLUMN cleared_at TEXT NOT NULL DEFAULT '';

UPDATE todos SET cleared_at = completed_at WHERE parent_id IS NULL AND completed_at <> '';

CREATE INDEX todos_user_cleared_order ON todos(user_id, cleared_at, sort_order);
