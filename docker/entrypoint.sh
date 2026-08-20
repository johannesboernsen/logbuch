#!/bin/sh
set -eu

mkdir -p /var/www/html/storage/projects
chown -R www-data:www-data /var/www/html/storage
chmod 770 /var/www/html/storage /var/www/html/storage/projects

exec docker-php-entrypoint "$@"

