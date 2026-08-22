FROM php:8.4-apache@sha256:5f8050825b2f3de4efb0d81149c86643a9ee9c0a74ed4595ca2ad69ebfeb35fb

LABEL org.opencontainers.image.source="https://github.com/johannesboernsen/logbuch"

RUN apt-get update \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/* \
    && a2enmod headers rewrite \
    && printf 'ServerName localhost\n' > /etc/apache2/conf-available/servername.conf \
    && a2enconf servername

ENV APACHE_DOCUMENT_ROOT=/var/www/html/public \
    LOGBUCH_PLATFORM=docker \
    LOGBUCH_STORAGE_PATH=/var/www/html/storage

COPY docker/apache-vhost.conf /etc/apache2/sites-available/000-default.conf
COPY docker/entrypoint.sh /usr/local/bin/logbuch-entrypoint
COPY app /var/www/html/app
COPY public /var/www/html/public
COPY config /var/www/html/config
COPY database /var/www/html/database
COPY VERSION SCHEMA_VERSION /var/www/html/
COPY storage/.htaccess /var/www/html/storage/.htaccess

RUN chmod +x /usr/local/bin/logbuch-entrypoint \
    && chmod -R a+rX /var/www/html/app /var/www/html/public /var/www/html/config /var/www/html/database \
    && chmod a+r /var/www/html/VERSION /var/www/html/SCHEMA_VERSION \
    && chown -R www-data:www-data /var/www/html/storage

VOLUME ["/var/www/html/storage"]
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://127.0.0.1/api/install/status >/dev/null || exit 1

ENTRYPOINT ["logbuch-entrypoint"]
CMD ["apache2-foreground"]
