#!/bin/sh
set -eu

project_dir=${1:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
request="$project_dir/makelog-data/updates/docker-request.json"
result="$project_dir/makelog-data/updates/docker-result.json"
state="$project_dir/makelog-data/updates/state.json"
env_file="$project_dir/.env"
backup="$project_dir/.env.makelog-update-backup"

[ -r "$project_dir/compose.yaml" ] || { printf '%s\n' 'Der Make:Log-Projektordner ist für den Host-Helfer nicht lesbar.' >&2; exit 1; }
[ -f "$request" ] || exit 0
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'Docker wurde nicht gefunden.' >&2; exit 1; }
lock="$project_dir/makelog-data/updates/docker-updater.lock"
mkdir "$lock" 2>/dev/null || exit 0
trap 'rmdir "$lock" 2>/dev/null || true' EXIT HUP INT TERM

json_value() {
  key=$1
  sed -n 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$request" | head -n 1
}

version=$(json_value version)
image=$(json_value image)
digest=$(json_value digest)
case "$version" in *[!0-9A-Za-z.-]*|'') printf '%s\n' 'Ungültige Update-Version.' >&2; exit 1;; esac
case "$image" in ghcr.io/johannesboernsen/make-log) ;; *) printf '%s\n' 'Nicht freigegebenes Update-Image.' >&2; exit 1;; esac
case "$digest" in sha256:????????????????????????????????????????????????????????????????) ;; *) printf '%s\n' 'Ungültiger Image-Digest.' >&2; exit 1;; esac
case "$digest" in *[!a-f0-9:]*) printf '%s\n' 'Ungültiger Image-Digest.' >&2; exit 1;; esac

mkdir -p "$(dirname "$result")"
cp "$env_file" "$backup"
temporary="$env_file.makelog-update"
sed '/^MAKELOG_IMAGE=/d' "$env_file" > "$temporary"
printf 'MAKELOG_IMAGE=%s@%s\n' "$image" "$digest" >> "$temporary"
mv "$temporary" "$env_file"
printf '{"status":"installing","version":"%s","message":"Docker-Image wird aktualisiert."}\n' "$version" > "$state"

if cd "$project_dir" && docker compose pull makelog && docker compose up -d --wait makelog; then
  printf '{"status":"success","version":"%s","message":"Docker-Update erfolgreich abgeschlossen."}\n' "$version" > "$result"
  mv "$request" "$request.processed"
  exit 0
fi

mv "$backup" "$env_file"
cd "$project_dir"
docker compose up -d --wait makelog || true
printf '{"status":"failed","version":"%s","message":"Docker-Update fehlgeschlagen; vorheriges Image wurde wieder aktiviert."}\n' "$version" > "$result"
exit 1
