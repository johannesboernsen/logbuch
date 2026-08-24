UPDATE todos
SET cleared_at = CASE WHEN cleared_at = '' THEN repeat_waiting_at ELSE cleared_at END,
    repeat_waiting_at = ''
WHERE parent_id IS NULL AND repeat_waiting_at <> '';

UPDATE todos
SET repeat_waiting_at = ''
WHERE repeat_waiting_at <> '';
