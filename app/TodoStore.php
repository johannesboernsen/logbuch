<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class TodoStore
{
    public function __construct(private readonly PDO $db) {}

    public function list(string $userId): array
    {
        $statement = $this->db->prepare('SELECT id, title, completed_at, sort_order, created_at, updated_at FROM todos WHERE user_id = :user ORDER BY CASE WHEN completed_at = \'\' THEN 0 ELSE 1 END, CASE WHEN completed_at = \'\' THEN sort_order END, CASE WHEN completed_at <> \'\' THEN completed_at END DESC, created_at DESC, id');
        $statement->execute(['user' => $userId]);
        return array_map(fn(array $row): array => $this->publicTodo($row), $statement->fetchAll());
    }

    public function create(string $userId, array $input): array
    {
        $title = $this->validTitle($input['title'] ?? '');
        $nextOrder = $this->db->prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM todos WHERE user_id = :user AND completed_at = \'\'');
        $nextOrder->execute(['user' => $userId]);
        $todo = [
            'id' => randomId('todo-'),
            'title' => $title,
            'completedAt' => '',
            'sortOrder' => (int) $nextOrder->fetchColumn(),
            'createdAt' => nowIso(),
            'updatedAt' => '',
        ];
        $statement = $this->db->prepare('INSERT INTO todos (id, user_id, title, completed_at, sort_order, created_at, updated_at) VALUES (:id, :user, :title, :completed, :sort, :created, :updated)');
        $statement->execute(['id' => $todo['id'], 'user' => $userId, 'title' => $title, 'completed' => '', 'sort' => $todo['sortOrder'], 'created' => $todo['createdAt'], 'updated' => '']);
        return $todo;
    }

    public function update(string $userId, string $id, array $input): array
    {
        $todo = $this->get($userId, $id);
        if (array_key_exists('title', $input)) $todo['title'] = $this->validTitle($input['title']);
        if (array_key_exists('completed', $input)) {
            if (!is_bool($input['completed'])) throw new HttpError(422, 'Ungültiger To-do-Status.');
            $completed = $input['completed'];
            if ($completed !== ($todo['completedAt'] !== '')) {
                $todo['completedAt'] = $completed ? nowIso() : '';
                if (!$completed) $todo['sortOrder'] = $this->nextOpenOrder($userId);
            }
        }
        $todo['updatedAt'] = nowIso();
        $statement = $this->db->prepare('UPDATE todos SET title = :title, completed_at = :completed, sort_order = :sort, updated_at = :updated WHERE id = :id AND user_id = :user');
        $statement->execute(['title' => $todo['title'], 'completed' => $todo['completedAt'], 'sort' => $todo['sortOrder'], 'updated' => $todo['updatedAt'], 'id' => $id, 'user' => $userId]);
        return $todo;
    }

    public function delete(string $userId, string $id): void
    {
        $statement = $this->db->prepare('DELETE FROM todos WHERE id = :id AND user_id = :user');
        $statement->execute(['id' => $id, 'user' => $userId]);
        if ($statement->rowCount() === 0) throw new HttpError(404, 'To-do nicht gefunden.');
    }

    public function deleteCompleted(string $userId): int
    {
        $statement = $this->db->prepare('DELETE FROM todos WHERE user_id = :user AND completed_at <> \'\'');
        $statement->execute(['user' => $userId]);
        return $statement->rowCount();
    }

    public function reorder(string $userId, mixed $ids): void
    {
        if (!is_array($ids) || count($ids) > 1000) throw new HttpError(422, 'Ungültige To-do-Reihenfolge.');
        foreach ($ids as $id) if (!is_string($id) || !validId($id)) throw new HttpError(422, 'Ungültige To-do-Reihenfolge.');
        if (count(array_unique($ids)) !== count($ids)) throw new HttpError(422, 'Ungültige To-do-Reihenfolge.');
        $openIds = array_column(array_filter($this->list($userId), static fn(array $todo): bool => $todo['completedAt'] === ''), 'id');
        if (count($ids) !== count($openIds) || array_diff($ids, $openIds) || array_diff($openIds, $ids)) throw new HttpError(422, 'Die To-do-Reihenfolge ist unvollständig.');
        $statement = $this->db->prepare('UPDATE todos SET sort_order = :sort, updated_at = :updated WHERE id = :id AND user_id = :user AND completed_at = \'\'');
        $updatedAt = nowIso();
        foreach ($ids as $index => $id) {
            $statement->execute(['sort' => $index, 'updated' => $updatedAt, 'id' => $id, 'user' => $userId]);
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
        $insert = $this->db->prepare('INSERT INTO todos (id, user_id, title, completed_at, sort_order, created_at, updated_at) VALUES (:id, :user, :title, :completed, :sort, :created, :updated)');
        foreach ($normalized as $todo) $insert->execute(['id' => $todo['id'], 'user' => $userId, 'title' => $todo['title'], 'completed' => $todo['completedAt'], 'sort' => $todo['sortOrder'], 'created' => $todo['createdAt'], 'updated' => $todo['updatedAt']]);
    }

    private function normalizeImported(mixed $todos): array
    {
        if (!is_array($todos) || count($todos) > 5000) throw new HttpError(422, 'Ungültige To-dos im Benutzerbackup.');
        $normalized = [];
        $ids = [];
        foreach ($todos as $index => $todo) {
            if (!is_array($todo) || !validId((string) ($todo['id'] ?? '')) || isset($ids[$todo['id']])) throw new HttpError(422, 'Ungültige To-dos im Benutzerbackup.');
            $ids[$todo['id']] = true;
            $normalized[] = [
                'id' => (string) $todo['id'],
                'title' => $this->validTitle($todo['title'] ?? ''),
                'completedAt' => $this->validTimestamp($todo['completedAt'] ?? ''),
                'sortOrder' => max(0, min(5000, (int) ($todo['sortOrder'] ?? $index))),
                'createdAt' => $this->validTimestamp($todo['createdAt'] ?? nowIso(), false),
                'updatedAt' => $this->validTimestamp($todo['updatedAt'] ?? ''),
            ];
        }
        return $normalized;
    }

    private function get(string $userId, string $id): array
    {
        if (!validId($id)) throw new HttpError(404, 'To-do nicht gefunden.');
        $statement = $this->db->prepare('SELECT id, title, completed_at, sort_order, created_at, updated_at FROM todos WHERE id = :id AND user_id = :user');
        $statement->execute(['id' => $id, 'user' => $userId]);
        $row = $statement->fetch();
        if (!$row) throw new HttpError(404, 'To-do nicht gefunden.');
        return $this->publicTodo($row);
    }

    private function nextOpenOrder(string $userId): int
    {
        $statement = $this->db->prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM todos WHERE user_id = :user AND completed_at = \'\'');
        $statement->execute(['user' => $userId]);
        return (int) $statement->fetchColumn();
    }

    private function validTitle(mixed $value): string
    {
        if (!is_scalar($value) && $value !== null) throw new HttpError(422, 'Ungültiger To-do-Text.');
        $title = trim((string) $value);
        if ($title === '' || mb_strlen($title) > 200) throw new HttpError(422, 'Ein To-do muss 1–200 Zeichen lang sein.');
        return $title;
    }

    private function validTimestamp(mixed $value, bool $allowEmpty = true): string
    {
        $timestamp = trim((string) $value);
        if ($timestamp === '' && $allowEmpty) return '';
        if ($timestamp === '' || strtotime($timestamp) === false) throw new HttpError(422, 'Ungültiger Zeitpunkt im To-do-Backup.');
        return mb_substr($timestamp, 0, 40);
    }

    private function publicTodo(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'title' => (string) $row['title'],
            'completedAt' => (string) $row['completed_at'],
            'sortOrder' => (int) $row['sort_order'],
            'createdAt' => (string) $row['created_at'],
            'updatedAt' => (string) $row['updated_at'],
        ];
    }
}
