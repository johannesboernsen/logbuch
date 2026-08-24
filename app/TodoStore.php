<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class TodoStore
{
    public function __construct(private readonly PDO $db) {}

    public function list(string $userId): array
    {
        $this->reopenDue($userId);
        $statement = $this->db->prepare('SELECT id, title, parent_id, completed_at, cleared_at, repeat_interval, repeat_unit, repeat_due_at, repeat_waiting_at, sort_order, created_at, updated_at FROM todos WHERE user_id = :user');
        $statement->execute(['user' => $userId]);
        $todos = array_map(fn(array $row): array => $this->publicTodo($row), $statement->fetchAll());
        return $this->orderedTree($todos);
    }

    public function create(string $userId, array $input): array
    {
        $title = $this->validTitle($input['title'] ?? '');
        $nextOrder = $this->db->prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM todos WHERE user_id = :user AND parent_id IS NULL AND cleared_at = \'\'');
        $nextOrder->execute(['user' => $userId]);
        $todo = [
            'id' => randomId('todo-'),
            'title' => $title,
            'parentId' => null,
            'completedAt' => '',
            'clearedAt' => '',
            'repeatInterval' => 0,
            'repeatUnit' => '',
            'repeatDueAt' => '',
            'repeatWaitingAt' => '',
            'sortOrder' => (int) $nextOrder->fetchColumn(),
            'createdAt' => nowIso(),
            'updatedAt' => '',
        ];
        $statement = $this->db->prepare('INSERT INTO todos (id, user_id, title, parent_id, completed_at, cleared_at, repeat_interval, repeat_unit, repeat_due_at, repeat_waiting_at, sort_order, created_at, updated_at) VALUES (:id, :user, :title, NULL, :completed, \'\', 0, \'\', \'\', \'\', :sort, :created, :updated)');
        $statement->execute(['id' => $todo['id'], 'user' => $userId, 'title' => $title, 'completed' => '', 'sort' => $todo['sortOrder'], 'created' => $todo['createdAt'], 'updated' => '']);
        return $todo;
    }

    public function update(string $userId, string $id, array $input): array
    {
        $todo = $this->get($userId, $id);
        if (array_key_exists('title', $input)) $todo['title'] = $this->validTitle($input['title']);
        if (array_key_exists('recurrence', $input)) {
            $recurrence = $this->validRecurrence($input['recurrence']);
            $todo['repeatInterval'] = $recurrence['interval'];
            $todo['repeatUnit'] = $recurrence['unit'];
            $todo['repeatDueAt'] = $todo['completedAt'] !== '' && $recurrence['interval'] > 0
                ? $this->nextDueAt($todo['completedAt'], $recurrence['interval'], $recurrence['unit'])
                : '';
            $todo['repeatWaitingAt'] = '';
        }
        if (array_key_exists('completed', $input)) {
            if (!is_bool($input['completed'])) throw new HttpError(422, 'Ungültiger Erinnerungsstatus.');
            $completed = $input['completed'];
            if ($completed !== ($todo['completedAt'] !== '')) {
                $todo['completedAt'] = $completed ? nowIso() : '';
                $todo['repeatDueAt'] = $completed && $todo['repeatInterval'] > 0
                    ? $this->nextDueAt($todo['completedAt'], $todo['repeatInterval'], $todo['repeatUnit'])
                    : '';
                $todo['repeatWaitingAt'] = '';
                if (!$completed) {
                    $todo['clearedAt'] = '';
                    if ($todo['parentId'] !== null) {
                        $parent = $this->db->prepare('UPDATE todos SET cleared_at = \'\', updated_at = :updated WHERE id = :parent AND user_id = :user');
                        $parent->execute(['updated' => nowIso(), 'parent' => $todo['parentId'], 'user' => $userId]);
                    }
                }
            }
        }
        $todo['updatedAt'] = nowIso();
        $statement = $this->db->prepare('UPDATE todos SET title = :title, parent_id = :parent, completed_at = :completed, cleared_at = :cleared, repeat_interval = :repeat_interval, repeat_unit = :repeat_unit, repeat_due_at = :repeat_due, repeat_waiting_at = :repeat_waiting, sort_order = :sort, updated_at = :updated WHERE id = :id AND user_id = :user');
        $statement->execute(['title' => $todo['title'], 'parent' => $todo['parentId'], 'completed' => $todo['completedAt'], 'cleared' => $todo['clearedAt'], 'repeat_interval' => $todo['repeatInterval'], 'repeat_unit' => $todo['repeatUnit'], 'repeat_due' => $todo['repeatDueAt'], 'repeat_waiting' => $todo['repeatWaitingAt'], 'sort' => $todo['sortOrder'], 'updated' => $todo['updatedAt'], 'id' => $id, 'user' => $userId]);
        return $todo;
    }

    public function cleanup(string $userId): int
    {
        $clearedAt = nowIso();
        $statement = $this->db->prepare(<<<'SQL'
            UPDATE todos
            SET cleared_at = :cleared, updated_at = :updated
            WHERE user_id = :user
              AND parent_id IS NULL
              AND completed_at <> ''
              AND cleared_at = ''
              AND NOT EXISTS (
                  SELECT 1 FROM todos AS child
                  WHERE child.user_id = :user
                    AND child.parent_id = todos.id
                    AND child.completed_at = ''
              )
        SQL);
        $statement->execute(['cleared' => $clearedAt, 'updated' => $clearedAt, 'user' => $userId]);
        return $statement->rowCount();
    }

    public function delete(string $userId, string $id): void
    {
        $statement = $this->db->prepare('DELETE FROM todos WHERE id = :id AND user_id = :user');
        $statement->execute(['id' => $id, 'user' => $userId]);
        if ($statement->rowCount() === 0) throw new HttpError(404, 'Erinnerung nicht gefunden.');
    }

    public function deleteCompleted(string $userId): int
    {
        $statement = $this->db->prepare(<<<'SQL'
            DELETE FROM todos
            WHERE user_id = :user
              AND parent_id IS NULL
              AND cleared_at <> ''
              AND repeat_interval = 0
              AND NOT EXISTS (
                  SELECT 1 FROM todos AS child
                  WHERE child.user_id = :user
                    AND child.parent_id = todos.id
                    AND child.repeat_interval > 0
              )
        SQL);
        $statement->execute(['user' => $userId]);
        return $statement->rowCount();
    }

    public function reorder(string $userId, mixed $items): void
    {
        if (!is_array($items) || count($items) > 1000) throw new HttpError(422, 'Ungültige Erinnerungsreihenfolge.');
        $normalized = [];
        foreach ($items as $item) {
            if (is_string($item)) $item = ['id' => $item, 'parentId' => null];
            if (!is_array($item) || !is_string($item['id'] ?? null) || !validId($item['id'])) throw new HttpError(422, 'Ungültige Erinnerungsreihenfolge.');
            $parentId = $item['parentId'] ?? null;
            if ($parentId === '') $parentId = null;
            if ($parentId !== null && (!is_string($parentId) || !validId($parentId))) throw new HttpError(422, 'Ungültige Erinnerungsreihenfolge.');
            $normalized[] = ['id' => $item['id'], 'parentId' => $parentId];
        }
        $ids = array_column($normalized, 'id');
        if (count(array_unique($ids)) !== count($ids)) throw new HttpError(422, 'Ungültige Erinnerungsreihenfolge.');
        $listed = $this->list($userId);
        $clearedRoots = array_fill_keys(array_column(array_filter($listed, static fn(array $todo): bool => $todo['parentId'] === null && $todo['clearedAt'] !== ''), 'id'), true);
        $activeIds = array_column(array_filter($listed, static fn(array $todo): bool => !isset($clearedRoots[$todo['parentId'] ?? $todo['id']])), 'id');
        if (count($ids) !== count($activeIds) || array_diff($ids, $activeIds) || array_diff($activeIds, $ids)) throw new HttpError(422, 'Die Erinnerungsreihenfolge ist unvollständig.');
        $parents = array_column($normalized, 'parentId', 'id');
        foreach ($normalized as $item) {
            $parentId = $item['parentId'];
            if ($parentId === null) continue;
            if ($parentId === $item['id'] || !array_key_exists($parentId, $parents) || $parents[$parentId] !== null) throw new HttpError(422, 'Erinnerungen können nur einer Erinnerung auf der Hauptebene direkt untergeordnet werden.');
        }
        $statement = $this->db->prepare('UPDATE todos SET parent_id = :parent, sort_order = :sort, updated_at = :updated WHERE id = :id AND user_id = :user');
        $updatedAt = nowIso();
        $orders = [];
        $this->db->beginTransaction();
        try {
            foreach ($normalized as $item) {
                $key = $item['parentId'] ?? '';
                $sortOrder = $orders[$key] ?? 0;
                $orders[$key] = $sortOrder + 1;
                $statement->execute(['parent' => $item['parentId'], 'sort' => $sortOrder, 'updated' => $updatedAt, 'id' => $item['id'], 'user' => $userId]);
            }
            $this->db->commit();
        } catch (\Throwable $error) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
    }

    public function validateImported(mixed $todos): void
    {
        $this->normalizeImported($todos);
    }

    public function replaceImported(string $userId, mixed $todos): void
    {
        $normalized = $this->normalizeImported($todos);
        $this->db->prepare('DELETE FROM todos WHERE user_id = :user')->execute(['user' => $userId]);
        $insert = $this->db->prepare('INSERT INTO todos (id, user_id, title, parent_id, completed_at, cleared_at, repeat_interval, repeat_unit, repeat_due_at, repeat_waiting_at, sort_order, created_at, updated_at) VALUES (:id, :user, :title, :parent, :completed, :cleared, :repeat_interval, :repeat_unit, :repeat_due, :repeat_waiting, :sort, :created, :updated)');
        foreach ($normalized as $todo) $insert->execute(['id' => $todo['id'], 'user' => $userId, 'title' => $todo['title'], 'parent' => $todo['parentId'], 'completed' => $todo['completedAt'], 'cleared' => $todo['clearedAt'], 'repeat_interval' => $todo['repeatInterval'], 'repeat_unit' => $todo['repeatUnit'], 'repeat_due' => $todo['repeatDueAt'], 'repeat_waiting' => $todo['repeatWaitingAt'], 'sort' => $todo['sortOrder'], 'created' => $todo['createdAt'], 'updated' => $todo['updatedAt']]);
    }

    private function normalizeImported(mixed $todos): array
    {
        if (!is_array($todos) || count($todos) > 5000) throw new HttpError(422, 'Ungültige Erinnerungen im Benutzerbackup.');
        $normalized = [];
        $ids = [];
        foreach ($todos as $index => $todo) {
            if (!is_array($todo) || !validId((string) ($todo['id'] ?? '')) || isset($ids[$todo['id']])) throw new HttpError(422, 'Ungültige Erinnerungen im Benutzerbackup.');
            $ids[$todo['id']] = true;
            $normalized[] = [
                'id' => (string) $todo['id'],
                'title' => $this->validTitle($todo['title'] ?? ''),
                'parentId' => ($todo['parentId'] ?? null) === '' ? null : ($todo['parentId'] ?? null),
                'completedAt' => $this->validTimestamp($todo['completedAt'] ?? ''),
                'clearedAt' => array_key_exists('clearedAt', $todo) ? $this->validTimestamp($todo['clearedAt']) : null,
                'repeatInterval' => max(0, min(999, (int) ($todo['repeatInterval'] ?? 0))),
                'repeatUnit' => (string) ($todo['repeatUnit'] ?? ''),
                'repeatDueAt' => $this->validTimestamp($todo['repeatDueAt'] ?? ''),
                'repeatWaitingAt' => $this->validTimestamp($todo['repeatWaitingAt'] ?? ''),
                'sortOrder' => max(0, min(5000, (int) ($todo['sortOrder'] ?? $index))),
                'createdAt' => $this->validTimestamp($todo['createdAt'] ?? nowIso(), false),
                'updatedAt' => $this->validTimestamp($todo['updatedAt'] ?? ''),
            ];
        }
        $parents = array_column($normalized, 'parentId', 'id');
        foreach ($normalized as &$todo) {
            $parentId = $todo['parentId'];
            if ($parentId !== null && (!is_string($parentId) || !validId($parentId) || $parentId === $todo['id'] || !array_key_exists($parentId, $parents) || $parents[$parentId] !== null)) {
                throw new HttpError(422, 'Ungültige Erinnerungshierarchie im Benutzerbackup.');
            }
            if ($todo['clearedAt'] === null) $todo['clearedAt'] = $parentId === null && $todo['completedAt'] !== '' ? $todo['completedAt'] : '';
            if ($parentId !== null) $todo['clearedAt'] = '';
            if ($todo['repeatWaitingAt'] !== '') {
                if ($parentId === null && $todo['clearedAt'] === '') $todo['clearedAt'] = $todo['repeatWaitingAt'];
                $todo['repeatWaitingAt'] = '';
            }
            if ($todo['clearedAt'] !== '' && $todo['completedAt'] === '') throw new HttpError(422, 'Ungültiger Aufräumstatus im Benutzerbackup.');
            if ($todo['repeatInterval'] === 0) {
                $todo['repeatUnit'] = '';
                $todo['repeatDueAt'] = '';
                $todo['repeatWaitingAt'] = '';
            } elseif (!in_array($todo['repeatUnit'], ['day', 'week', 'month', 'year'], true)) {
                throw new HttpError(422, 'Ungültige Wiederholung im Benutzerbackup.');
            } elseif ($todo['completedAt'] === '' && $todo['repeatDueAt'] !== '') {
                throw new HttpError(422, 'Ungültiger Wiederholungszeitpunkt im Benutzerbackup.');
            }
        }
        unset($todo);
        usort($normalized, static fn(array $left, array $right): int => ($left['parentId'] === null ? 0 : 1) <=> ($right['parentId'] === null ? 0 : 1));
        return $normalized;
    }

    private function get(string $userId, string $id): array
    {
        if (!validId($id)) throw new HttpError(404, 'Erinnerung nicht gefunden.');
        $statement = $this->db->prepare('SELECT id, title, parent_id, completed_at, cleared_at, repeat_interval, repeat_unit, repeat_due_at, repeat_waiting_at, sort_order, created_at, updated_at FROM todos WHERE id = :id AND user_id = :user');
        $statement->execute(['id' => $id, 'user' => $userId]);
        $row = $statement->fetch();
        if (!$row) throw new HttpError(404, 'Erinnerung nicht gefunden.');
        return $this->publicTodo($row);
    }

    private function orderedTree(array $todos): array
    {
        $byId = array_column($todos, null, 'id');
        $children = [];
        $roots = [];
        foreach ($todos as $todo) {
            $parentId = $todo['parentId'];
            if ($parentId !== null && isset($byId[$parentId])) $children[$parentId][] = $todo;
            else $roots[] = $todo;
        }
        usort($roots, static function(array $left, array $right): int {
            $leftCleared = $left['clearedAt'] !== '';
            $rightCleared = $right['clearedAt'] !== '';
            if ($leftCleared !== $rightCleared) return $leftCleared <=> $rightCleared;
            if ($leftCleared) return strcmp($right['clearedAt'], $left['clearedAt']) ?: strcmp($right['createdAt'], $left['createdAt']);
            return $left['sortOrder'] <=> $right['sortOrder'] ?: strcmp($left['createdAt'], $right['createdAt']);
        });
        $ordered = [];
        foreach ($roots as $root) {
            $ordered[] = $root;
            $siblings = $children[$root['id']] ?? [];
            usort($siblings, static fn(array $left, array $right): int => $left['sortOrder'] <=> $right['sortOrder'] ?: strcmp($left['createdAt'], $right['createdAt']));
            array_push($ordered, ...$siblings);
        }
        return $ordered;
    }

    private function validTitle(mixed $value): string
    {
        if (!is_scalar($value) && $value !== null) throw new HttpError(422, 'Ungültiger Erinnerungstext.');
        $title = trim((string) $value);
        if ($title === '' || mb_strlen($title) > 200) throw new HttpError(422, 'Eine Erinnerung muss 1–200 Zeichen lang sein.');
        return $title;
    }

    private function validTimestamp(mixed $value, bool $allowEmpty = true): string
    {
        $timestamp = trim((string) $value);
        if ($timestamp === '' && $allowEmpty) return '';
        if ($timestamp === '' || strtotime($timestamp) === false) throw new HttpError(422, 'Ungültiger Zeitpunkt im Erinnerungsbackup.');
        return mb_substr($timestamp, 0, 40);
    }

    private function validRecurrence(mixed $value): array
    {
        if ($value === null) return ['interval' => 0, 'unit' => ''];
        if (!is_array($value)) throw new HttpError(422, 'Ungültige Wiederholung.');
        $interval = filter_var($value['interval'] ?? null, FILTER_VALIDATE_INT);
        $unit = (string) ($value['unit'] ?? '');
        if ($interval === false || $interval < 1 || $interval > 999 || !in_array($unit, ['day', 'week', 'month', 'year'], true)) {
            throw new HttpError(422, 'Die Wiederholung muss zwischen 1 und 999 Tagen, Wochen, Monaten oder Jahren liegen.');
        }
        return ['interval' => $interval, 'unit' => $unit];
    }

    private function nextDueAt(string $completedAt, int $interval, string $unit): string
    {
        $date = new \DateTimeImmutable($completedAt, new \DateTimeZone('UTC'));
        return $date->modify(sprintf('+%d %s%s', $interval, $unit, $interval === 1 ? '' : 's'))->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
    }

    private function reopenDue(string $userId): void
    {
        $now = nowIso();
        $parents = $this->db->prepare('SELECT DISTINCT parent_id FROM todos WHERE user_id = :user AND parent_id IS NOT NULL AND repeat_due_at <> \'\' AND repeat_due_at <= :now');
        $parents->execute(['user' => $userId, 'now' => $now]);
        $parentIds = array_values(array_filter(array_column($parents->fetchAll(), 'parent_id')));
        $statement = $this->db->prepare('UPDATE todos SET completed_at = \'\', cleared_at = \'\', repeat_due_at = \'\', repeat_waiting_at = \'\', updated_at = :updated WHERE user_id = :user AND repeat_due_at <> \'\' AND repeat_due_at <= :now');
        $statement->execute(['updated' => $now, 'user' => $userId, 'now' => $now]);
        if ($parentIds) {
            $placeholders = implode(',', array_fill(0, count($parentIds), '?'));
            $parentUpdate = $this->db->prepare("UPDATE todos SET cleared_at = '', updated_at = ? WHERE user_id = ? AND id IN ($placeholders)");
            $parentUpdate->execute([$now, $userId, ...$parentIds]);
        }
    }

    private function publicTodo(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'title' => (string) $row['title'],
            'parentId' => ($row['parent_id'] ?? null) === null || $row['parent_id'] === '' ? null : (string) $row['parent_id'],
            'completedAt' => (string) $row['completed_at'],
            'clearedAt' => (string) ($row['cleared_at'] ?? ''),
            'repeatInterval' => (int) ($row['repeat_interval'] ?? 0),
            'repeatUnit' => (string) ($row['repeat_unit'] ?? ''),
            'repeatDueAt' => (string) ($row['repeat_due_at'] ?? ''),
            'repeatWaitingAt' => (string) ($row['repeat_waiting_at'] ?? ''),
            'sortOrder' => (int) $row['sort_order'],
            'createdAt' => (string) $row['created_at'],
            'updatedAt' => (string) $row['updated_at'],
        ];
    }
}
