# The "app" container: the Laravel backend (PHP-FPM), and the build of the Phaser frontend and the
# marketing page.
#
# The image holds only the tools: PHP with its extensions, Composer and Node. The code is not copied
# in. docker-compose.yml mounts it from the checkout instead, so edits show without a rebuild:
#
#   ./apps/api        -> /app                  the Laravel application (the server)
#   ./apps/client     -> /repo/apps/client     the game and the marketing page (the client), built
#   ./packages/shared -> /repo/packages/shared   by Vite on start into the "public" volume, and
#   ./scenarios/assets-> /repo/scenarios/assets  rebuilt on every change while QBL_CLIENT_WATCH=true
#
# Built by Compose from this folder (context: docker/app). On its own it has nothing to run.

FROM node:22-alpine AS node

FROM php:8.4-fpm-alpine

# zip: scenarios are exported and imported as ZIP files (App\Qbl\ScenarioArchive).
# gd: the AI scenario generator cuts out, sizes and colour-matches pictures (App\Qbl\Generation\Art\ImageTools).
# shadow + su-exec: apps/api is mounted from the host, so www-data takes the host owner's user id
# and php runs as that user (see entrypoint.sh and php-as-owner.sh).
# git: npm fetches at least one package in the client's dependency tree from a git URL.
# libstdc++: Node needs it.
RUN apk add --no-cache git unzip shadow su-exec libstdc++ libzip-dev libpng-dev libjpeg-turbo-dev libwebp-dev freetype-dev \
    && docker-php-ext-configure gd --with-jpeg --with-webp --with-freetype \
    && docker-php-ext-install pdo_mysql opcache zip gd
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
# Composer's cache is shared by whichever user runs it (root on first start, the host's user after).
ENV COMPOSER_HOME=/composer
RUN mkdir -p /composer && chmod 1777 /composer

# Node 22 and npm, to build the client (both images are Alpine, so the binary runs as it is).
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && node --version && npm --version

COPY php.ini /usr/local/etc/php/conf.d/qbl.ini
COPY entrypoint.sh /usr/local/bin/qbl-entrypoint
# Earlier in PATH than the real php, so "php artisan" and "composer" run as the owner of /app.
COPY php-as-owner.sh /usr/local/sbin/php
RUN chmod +x /usr/local/bin/qbl-entrypoint /usr/local/sbin/php \
    && mkdir -p /app /repo /data /shared/public /shared/editor /media-data

WORKDIR /app
EXPOSE 9000
ENTRYPOINT ["qbl-entrypoint"]
CMD ["php-fpm"]
