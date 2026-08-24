ALTER TABLE todos ADD COLUMN parent_id TEXT REFERENCES todos(id) ON DELETE CASCADE;

CREATE INDEX todos_user_parent_state_order ON todos(user_id, parent_id, completed_at, sort_order);
