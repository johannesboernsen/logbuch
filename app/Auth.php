<?php

declare(strict_types=1);

namespace Logbuch;

use PDO;

final class Auth
{
    private const SESSION_LIFETIME = 1209600;

    public function __construct(private readonly PDO $db)
    {
    }

    public function createAdmin(string $id, string $password): void
    {
        $id = trim($id);
        if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/', $id)) {
            throw new HttpError(422, 'Der Benutzername muss 3–40 Zeichen lang sein und darf nur Buchstaben, Zahlen, Punkt, Unterstrich und Bindestrich enthalten.');
        }
        $this->validatePassword($password);
        $statement = $this->db->prepare('INSERT INTO users (id, role, active, access_mode, password_hash, must_change_password, preferences_json, created_at) VALUES (:id, :role, 1, :access, :hash, 0, :preferences, :created)');
        $statement->execute([
            'id' => $id,
            'role' => 'admin',
            'access' => 'all',
            'hash' => password_hash($password, PASSWORD_ARGON2ID),
            'preferences' => json_encode($this->defaultPreferences()),
            'created' => nowIso(),
        ]);
    }

    public function login(string $id, string $password, string $ip, string $userAgent): array
    {
        $identity = hash('sha256', mb_strtolower(trim($id)) . '|' . $ip);
        $origin = 'origin:' . hash('sha256', $ip);
        $this->reserveLoginAttempt([$identity => 5, $origin => 20]);

        $statement = $this->db->prepare('SELECT * FROM users WHERE id = :id');
        $statement->execute(['id' => trim($id)]);
        $user = $statement->fetch();
        if (!$user || !(bool) $user['active'] || !password_verify($password, $user['password_hash'])) {
            usleep(250000);
            throw new HttpError(401, 'Benutzername oder Passwort ist falsch.');
        }

        $this->db->prepare('DELETE FROM login_attempts WHERE identity = :identity')->execute(['identity' => $identity]);
        $this->db->prepare('DELETE FROM login_attempts WHERE identity = :identity')->execute(['identity' => $origin]);
        if (password_needs_rehash($user['password_hash'], PASSWORD_ARGON2ID)) {
            $this->db->prepare('UPDATE users SET password_hash = :hash WHERE id = :id')->execute(['hash' => password_hash($password, PASSWORD_ARGON2ID), 'id' => $user['id']]);
        }

        $token = bin2hex(random_bytes(32));
        $sessionId = randomId('session-');
        $now = time();
        $this->db->prepare('DELETE FROM sessions WHERE touched_at < :expired')->execute(['expired' => $now - self::SESSION_LIFETIME]);
        $this->db->prepare('INSERT INTO sessions (id, token_hash, user_id, created_at, touched_at, ip, user_agent) VALUES (:id, :token, :user, :created, :touched, :ip, :agent)')->execute([
            'id' => $sessionId,
            'token' => hash('sha256', $token),
            'user' => $user['id'],
            'created' => $now,
            'touched' => $now,
            'ip' => mb_substr($ip, 0, 64),
            'agent' => mb_substr($userAgent, 0, 255),
        ]);
        $this->db->prepare('UPDATE users SET last_login_at = :now WHERE id = :id')->execute(['now' => nowIso(), 'id' => $user['id']]);
        $this->setSessionCookie($token, $now + self::SESSION_LIFETIME);
        // PHP exposes newly set cookies only on the next request. Keeping the
        // current request in sync lets the login response contain a token that
        // is already valid for the session cookie sent with that response.
        $_COOKIE['logbuch_session'] = $token;
        $user['session_id'] = $sessionId;
        return $this->publicUser($user);
    }

    private function reserveLoginAttempt(array $limits): void
    {
        $transactionActive = false;
        try {
            $this->db->exec('BEGIN IMMEDIATE');
            $transactionActive = true;
            $now = (int) $this->db->query("SELECT CAST(strftime('%s','now') AS INTEGER)")->fetchColumn();
            $select = $this->db->prepare('SELECT blocked_until, updated_at FROM login_attempts WHERE identity = :identity');
            foreach ($limits as $identity => $threshold) {
                $select->execute(['identity' => $identity]);
                $row = $select->fetch();
                if ($row && (int) $row['updated_at'] >= $now - 900 && (int) $row['blocked_until'] > $now) {
                    throw new HttpError(429, 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.');
                }
            }
            $upsert = $this->db->prepare('INSERT INTO login_attempts (identity, attempts, blocked_until, updated_at) VALUES (:identity, 1, 0, :now) ON CONFLICT(identity) DO UPDATE SET attempts = CASE WHEN login_attempts.updated_at < :stale THEN 1 ELSE login_attempts.attempts + 1 END, blocked_until = 0, updated_at = :updated');
            $block = $this->db->prepare("UPDATE login_attempts SET blocked_until = CASE WHEN attempts >= :threshold THEN CAST(strftime('%s','now') AS INTEGER) + MIN(900, 15 * (1 << MIN(6, attempts - :threshold_again))) ELSE 0 END WHERE identity = :identity");
            foreach ($limits as $identity => $threshold) {
                $upsert->execute(['identity' => $identity, 'now' => $now, 'stale' => $now - 900, 'updated' => $now]);
                $block->execute(['identity' => $identity, 'threshold' => $threshold, 'threshold_again' => $threshold]);
            }
            $this->db->exec('COMMIT');
            $transactionActive = false;
        } catch (\Throwable $error) {
            if ($transactionActive) {
                try {
                    $this->db->exec('ROLLBACK');
                } catch (\Throwable) {
                }
            }
            if ($error instanceof \PDOException && str_contains(strtolower($error->getMessage()), 'database is locked')) {
                throw new HttpError(429, 'Zu viele gleichzeitige Anmeldeversuche. Bitte später erneut versuchen.');
            }
            throw $error;
        }
    }

    public function current(bool $touch = true): ?array
    {
        $token = $_COOKIE['logbuch_session'] ?? '';
        if (!is_string($token) || strlen($token) !== 64) {
            return null;
        }
        $statement = $this->db->prepare('SELECT users.*, sessions.id AS session_id, sessions.created_at AS session_created_at, sessions.touched_at AS session_touched_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = :token AND sessions.touched_at >= :valid AND users.active = 1');
        $statement->execute(['token' => hash('sha256', $token), 'valid' => time() - self::SESSION_LIFETIME]);
        $user = $statement->fetch();
        if (!$user) {
            return null;
        }
        if ($touch && (int) $user['session_touched_at'] < time() - 300) {
            try {
                $this->db->prepare('UPDATE sessions SET touched_at = :now WHERE id = :id AND touched_at < :threshold')->execute([
                    'now' => time(),
                    'id' => $user['session_id'],
                    'threshold' => time() - 300,
                ]);
            } catch (\PDOException $error) {
                // Several page resources are loaded in parallel. Session
                // refreshes are best-effort and must never make a read fail
                // merely because another SQLite writer currently holds the lock.
                if (!str_contains(strtolower($error->getMessage()), 'database is locked')) {
                    throw $error;
                }
            }
        }
        return $this->publicUser($user);
    }

    public function requireUser(bool $admin = false, bool $allowPasswordChangeOnly = false, bool $touch = true): array
    {
        $user = $this->current($touch);
        if (!$user) {
            throw new HttpError(401, 'Anmeldung erforderlich.');
        }
        if ($user['mustChangePassword'] && !$allowPasswordChangeOnly) {
            throw new HttpError(428, 'Passwortänderung erforderlich.');
        }
        if ($admin && !$user['admin']) {
            throw new HttpError(403, 'Administratorrechte erforderlich.');
        }
        return $user;
    }

    public function logout(): void
    {
        $user = $this->current(false);
        if ($user) {
            $this->db->prepare('DELETE FROM sessions WHERE id = :id')->execute(['id' => $user['sessionId']]);
        }
        $this->setSessionCookie('', time() - 3600);
    }

    public function changePassword(array $user, string $currentPassword, string $newPassword): void
    {
        $statement = $this->db->prepare('SELECT password_hash FROM users WHERE id = :id');
        $statement->execute(['id' => $user['id']]);
        $hash = (string) $statement->fetchColumn();
        if (!password_verify($currentPassword, $hash)) {
            throw new HttpError(401, 'Aktuelles Passwort ist falsch.');
        }
        $this->validatePassword($newPassword);
        $this->db->prepare('UPDATE users SET password_hash = :hash, must_change_password = 0 WHERE id = :id')->execute(['hash' => password_hash($newPassword, PASSWORD_ARGON2ID), 'id' => $user['id']]);
        $this->db->prepare('DELETE FROM sessions WHERE user_id = :id AND id <> :session')->execute(['id' => $user['id'], 'session' => $user['sessionId']]);
    }

    public function verifyPassword(array $user, string $password): void
    {
        $statement = $this->db->prepare('SELECT password_hash FROM users WHERE id = :id AND active = 1');
        $statement->execute(['id' => $user['id']]);
        $hash = (string) $statement->fetchColumn();
        if ($password === '' || $hash === '' || !password_verify($password, $hash)) {
            throw new HttpError(401, 'Das Administratorpasswort ist falsch.');
        }
    }

    public function publicUser(array $row): array
    {
        $storedPreferences = json_decode((string) ($row['preferences_json'] ?? '{}'), true);
        $storedPreferences = is_array($storedPreferences) ? $storedPreferences : [];
        $preferences = array_replace($this->defaultPreferences(), $storedPreferences);
        if (!array_key_exists('showOverviewDueSoon', $storedPreferences) && array_key_exists('showOverviewFocus', $storedPreferences)) {
            $preferences['showOverviewDueSoon'] = (bool) $storedPreferences['showOverviewFocus'];
        }
        if (!array_key_exists('showOverviewHighPriority', $storedPreferences) && array_key_exists('showOverviewFocus', $storedPreferences)) {
            $preferences['showOverviewHighPriority'] = (bool) $storedPreferences['showOverviewFocus'];
        }
        if (!array_key_exists('overviewDueSoonRows', $storedPreferences) && isset($storedPreferences['overviewFocusRows'])) {
            $preferences['overviewDueSoonRows'] = (int) $storedPreferences['overviewFocusRows'];
        }
        if (!array_key_exists('overviewHighPriorityRows', $storedPreferences) && isset($storedPreferences['overviewFocusRows'])) {
            $preferences['overviewHighPriorityRows'] = (int) $storedPreferences['overviewFocusRows'];
        }
        $allowedOrder = $this->defaultPreferences()['overviewOrder'];
        $storedOrder = is_array($preferences['overviewOrder'] ?? null) ? $preferences['overviewOrder'] : [];
        $normalizedOrder = [];
        foreach ($storedOrder as $section) {
            $sections = $section === 'focus' ? ['dueSoon', 'highPriority'] : [$section];
            foreach ($sections as $normalizedSection) {
                if (in_array($normalizedSection, $allowedOrder, true) && !in_array($normalizedSection, $normalizedOrder, true)) {
                    $normalizedOrder[] = $normalizedSection;
                }
            }
        }
        if (!in_array('marked', $normalizedOrder, true)) {
            $insertAfter = array_search('recentlyEdited', $normalizedOrder, true);
            array_splice($normalizedOrder, $insertAfter === false ? 0 : $insertAfter + 1, 0, ['marked']);
        }
        $preferences['overviewOrder'] = array_merge($normalizedOrder, array_values(array_diff($allowedOrder, $normalizedOrder)));
        unset($preferences['showOverviewFocus'], $preferences['overviewFocusRows']);
        return [
            'id' => (string) $row['id'],
            'name' => (string) $row['id'],
            'role' => (string) $row['role'],
            'admin' => $row['role'] === 'admin',
            'active' => (bool) $row['active'],
            'projectAccessMode' => (string) $row['access_mode'],
            'mustChangePassword' => (bool) $row['must_change_password'],
            'createdAt' => (string) $row['created_at'],
            'lastLoginAt' => (string) ($row['last_login_at'] ?? ''),
            'sessionId' => (string) ($row['session_id'] ?? ''),
            ...$preferences,
        ];
    }

    public function defaultPreferences(): array
    {
        return [
            'startPage' => 'home',
            'projectSort' => 'status:asc',
            'archiveSort' => 'createdAt:desc',
            'defaultProjectIcon' => 'box',
            'showProjectFolders' => true,
            'projectStatuses' => ['idea', 'active'],
            'projectBrowserView' => 'columns',
            'pinnedProjectFolders' => [],
            'recentProjectFolders' => [],
            'showOverviewSummary' => true,
            'showOverviewRecent' => true,
            'showOverviewNext' => true,
            'showOverviewRecentlyEdited' => true,
            'showOverviewMarked' => true,
            'showOverviewDueSoon' => true,
            'showOverviewHighPriority' => true,
            'showOverviewActivity' => true,
            'showOverviewTimeline' => true,
            'overviewRecentRows' => 2,
            'overviewNextRows' => 2,
            'overviewRecentlyEditedRows' => 1,
            'overviewMarkedRows' => 1,
            'overviewDueSoonRows' => 2,
            'overviewHighPriorityRows' => 2,
            'overviewOrder' => ['summary', 'recentlyEdited', 'marked', 'dueSoon', 'highPriority', 'next', 'recent', 'activity', 'timeline'],
            'inventoryLabelOutputMode' => 'sheet',
            'inventoryLabelProfileId' => 'generic-62x29',
            'inventoryLabelProfiles' => [],
        ];
    }

    public function validatePassword(string $password): void
    {
        if (mb_strlen($password) < 10 || mb_strlen($password) > 128) {
            throw new HttpError(422, 'Das Passwort muss 10–128 Zeichen lang sein.');
        }
    }

    private function setSessionCookie(string $token, int $expires): void
    {
        $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
        setcookie('logbuch_session', $token, [
            'expires' => $expires,
            'path' => '/',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
    }
}
