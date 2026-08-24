ALTER TABLE todos ADD COLUMN repeat_waiting_at TEXT NOT NULL DEFAULT '';

CREATE INDEX todos_user_repeat_waiting ON todos(user_id, repeat_waiting_at);
