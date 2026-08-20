<?php

declare(strict_types=1);

namespace MakeLog;

final class HttpError extends \RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

function nowIso(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

function randomId(string $prefix = ''): string
{
    return $prefix . bin2hex(random_bytes(12));
}

function validId(string $value): bool
{
    return preg_match('/^[A-Za-z0-9_-]{3,64}$/', $value) === 1;
}

function validDate(string $value): bool
{
    $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $value, new \DateTimeZone('UTC'));
    return $date !== false && $date->format('Y-m-d') === $value;
}

function normalizeName(string $value): string
{
    $value = trim(preg_replace('/\s+/u', ' ', $value) ?? $value);
    return mb_strtolower($value, 'UTF-8');
}

function slug(string $value): string
{
    $normalized = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', normalizeName($value));
    $normalized = preg_replace('/[^a-z0-9]+/', '-', strtolower($normalized ?: '')) ?? '';
    return trim($normalized, '-') ?: 'eintrag';
}

function readJsonFile(string $path, array $fallback = []): array
{
    if (!is_file($path)) {
        return $fallback;
    }
    $decoded = json_decode((string) file_get_contents($path), true);
    return is_array($decoded) ? $decoded : $fallback;
}

function atomicWrite(string $path, string $content): void
{
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
        throw new HttpError(507, 'Das Speicherverzeichnis konnte nicht angelegt werden.');
    }
    $temporary = $path . '.tmp-' . bin2hex(random_bytes(4));
    $handle = fopen($temporary, 'xb');
    if ($handle === false) {
        throw new HttpError(507, 'Temporäre Datei konnte nicht angelegt werden.');
    }
    try {
        if (!flock($handle, LOCK_EX) || fwrite($handle, $content) !== strlen($content) || !fflush($handle)) {
            throw new HttpError(507, 'Datei konnte nicht vollständig geschrieben werden.');
        }
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
    if (!rename($temporary, $path)) {
        @unlink($temporary);
        throw new HttpError(507, 'Datei konnte nicht atomar ersetzt werden.');
    }
    @chmod($path, 0660);
}

function writeJsonFile(string $path, array $value): void
{
    atomicWrite($path, json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
}

function removeTree(string $path): void
{
    if (!file_exists($path)) {
        return;
    }
    if (is_file($path) || is_link($path)) {
        if (!unlink($path)) {
            throw new HttpError(507, 'Datei konnte nicht gelöscht werden.');
        }
        return;
    }
    foreach (new \FilesystemIterator($path) as $item) {
        removeTree($item->getPathname());
    }
    if (!rmdir($path)) {
        throw new HttpError(507, 'Verzeichnis konnte nicht gelöscht werden.');
    }
}

function yamlScalar(mixed $value): string
{
    if (is_bool($value)) {
        return $value ? 'true' : 'false';
    }
    if (is_int($value) || is_float($value)) {
        return (string) $value;
    }
    $text = str_replace(["\\", '"', "\r", "\n"], ["\\\\", '\\"', '', '\\n'], (string) $value);
    return '"' . $text . '"';
}

function frontmatter(array $fields): string
{
    $lines = ['---'];
    foreach ($fields as $key => $value) {
        if ($value === null || $value === '' || is_array($value)) {
            if (is_array($value)) {
                $lines[] = $key . ': [' . implode(', ', array_map('MakeLog\\yamlScalar', $value)) . ']';
            }
            continue;
        }
        $lines[] = $key . ': ' . yamlScalar($value);
    }
    $lines[] = '---';
    return implode("\n", $lines) . "\n";
}
