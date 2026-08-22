FROM docker:29-cli

RUN apk add --no-cache nodejs openssl

COPY docker/updater/updater.mjs /usr/local/bin/logbuch-updater.mjs
COPY docker/updater/handoff.sh /usr/local/bin/logbuch-updater-handoff
COPY docker/updater/compose.runtime.yaml /opt/logbuch/compose.yaml
COPY config/update-public-key.pem /etc/logbuch/update-public-key.pem

RUN chmod 0555 /usr/local/bin/logbuch-updater-handoff

HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
  CMD test -f /var/lib/logbuch/updates/updater-heartbeat && test -n "$(find /var/lib/logbuch/updates/updater-heartbeat -mmin -2 -print -quit)"

ENTRYPOINT ["node", "/usr/local/bin/logbuch-updater.mjs"]
