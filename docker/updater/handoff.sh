#!/bin/sh
set -eu

updates=/var/lib/logbuch/updates
compose_file=/opt/logbuch/compose.yaml
base_env="$updates/base.env"
app_env="$updates/image.env"
updater_env="$updates/updater-image.env"
previous_env="$updates/updater-image.previous.env"
result="$updates/updater-result.json"

compose() {
  docker compose --project-name logbuch \
    --env-file "$base_env" \
    --env-file "$app_env" \
    --env-file "$updater_env" \
    -f "$compose_file" "$@"
}

write_result() {
  status="$1"
  message="$2"
  escaped=$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"status":"%s","message":"%s","updatedAt":"%s"}\n' \
    "$status" "$escaped" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$result.tmp"
  mv "$result.tmp" "$result"
}

sleep 3
if compose pull logbuch-updater && compose up -d --no-deps --wait --wait-timeout 120 logbuch-updater; then
  write_result success "Der AIO-Updater wurde aktualisiert."
  exit 0
fi

if test -f "$previous_env"; then
  cp "$previous_env" "$updater_env"
  if compose up -d --no-deps --wait --wait-timeout 120 logbuch-updater; then
    write_result failed "Das Updater-Update ist fehlgeschlagen; die vorherige Version wurde wiederhergestellt."
    exit 1
  fi
fi

write_result failed "Das Updater-Update und die automatische Wiederherstellung sind fehlgeschlagen."
exit 1
