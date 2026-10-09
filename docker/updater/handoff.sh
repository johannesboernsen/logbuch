#!/bin/sh
set -eu

updates=/var/lib/logbuch-private/updates
result=/var/lib/logbuch/updates/updater-result.json
compose_file=/opt/logbuch/compose.yaml
target="${1:?missing signed updater image}"
previous="${2:?missing previous updater image}"

compose() {
  docker compose --project-name logbuch \
    --env-file "$updates/base.env" \
    --env-file "$updates/image.env" \
    --env-file "$updates/updater-image.env" \
    -f "$compose_file" "$@"
}

check_config() {
  compose config --format json | node -e '
    let input = "";
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      const services = JSON.parse(input).services;
      if (services?.logbuch?.image !== process.argv[1] ||
          services?.["logbuch-updater"]?.image !== process.argv[2]) process.exit(1);
    });
  ' "$app_image" "$updater_image"
}

write_result() {
  node - "$1" "$2" "$result" <<'NODE'
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const [status, message, path] = process.argv.slice(2);
process.setgid(33);
process.setuid(33);
const temporary = `${path}.tmp-${randomUUID()}`;
const fd = fs.openSync(temporary, 'wx', 0o660);
try {
  fs.writeFileSync(fd, JSON.stringify({status, message, updatedAt: new Date().toISOString()}) + '\n');
} finally {
  fs.closeSync(fd);
}
fs.renameSync(temporary, path);
NODE
}

app_image=$(sed -n 's/^LOGBUCH_IMAGE=//p' "$updates/image.env")
updater_image="$target"
sleep 3
if check_config && compose pull logbuch-updater && check_config && compose up -d --no-deps --wait --wait-timeout 120 logbuch-updater; then
  write_result success "Der AIO-Updater wurde aktualisiert."
  exit 0
fi

updater_image="$previous"
printf 'LOGBUCH_UPDATER_IMAGE=%s\n' "$previous" > "$updates/updater-image.env.tmp"
mv "$updates/updater-image.env.tmp" "$updates/updater-image.env"
if check_config && compose up -d --no-deps --wait --wait-timeout 120 logbuch-updater; then
  write_result failed "Das Updater-Update ist fehlgeschlagen; die vorherige Version wurde wiederhergestellt."
  exit 1
fi

write_result failed "Das Updater-Update und die automatische Wiederherstellung sind fehlgeschlagen."
exit 1
