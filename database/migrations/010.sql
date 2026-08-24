ALTER TABLE todos ADD COLUMN repeat_interval INTEGER NOT NULL DEFAULT 0;
ALTER TABLE todos ADD COLUMN repeat_unit TEXT NOT NULL DEFAULT '';
ALTER TABLE todos ADD COLUMN repeat_due_at TEXT NOT NULL DEFAULT '';

CREATE INDEX todos_user_repeat_due ON todos(user_id, repeat_due_at);
