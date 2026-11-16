# The "app" container: the Laravel backend (PHP-FPM) and the built Phaser frontend.
# Build from the repository root:  docker build -f docker/app/Dockerfile .

# ---- 1. build the Phaser frontend ---------------------------------------------------
FROM node:22-alpine AS frontend
# npm needs git: at least one package in the dependency tree is fetched from a git URL.
RUN apk add --no-cache git
WORKDIR /repo
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY apps/editor/package.json apps/editor/
# Switch to `npm ci` once package-lock.json is committed.
RUN npm install --workspace @qbl/shared --workspace @qbl/client --include-workspace-root
COPY packages/shared packages/shared
COPY apps/client apps/client
# login: email + password against Laravel, with a "play as guest" link.
ARG VITE_AUTH_MODE=login
ARG VITE_DEFAULT_SCENARIO=starshipexplorer
ENV VITE_AUTH_MODE=$VITE_AUTH_MODE VITE_DEFAULT_SCENARIO=$VITE_DEFAULT_SCENARIO
# Bundles without the type-check step, so a typing complaint cannot block the image. Run `npm run typecheck` in CI.
RUN npm exec --workspace @qbl/client -- vite build

# ---- 2. Laravel + the frontend in its public directory -------------------------------
FROM php:8.4-fpm-alpine
ARG LARAVEL_VERSION=^13.0

RUN apk add --no-cache git unzip \
    && docker-php-ext-install pdo_mysql opcache
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app
# The repository holds only what differs from a stock Laravel application (apps/api/overlay).
# This creates the skeleton and lays the overlay on top.
RUN composer create-project --no-interaction --prefer-dist laravel/laravel . "${LARAVEL_VERSION}" \
    && php artisan install:api --no-interaction \
    && rm -f database/database.sqlite
COPY apps/api/overlay/ /app/
RUN composer dump-autoload --optimize

# The game: index.html and its bundles sit beside Laravel's index.php, and scenario media beside them.
COPY --from=frontend /repo/apps/client/dist/ /app/public/
COPY scenarios/assets/ /app/public/scenario-assets/

COPY docker/app/php.ini /usr/local/etc/php/conf.d/qbl.ini
COPY docker/app/entrypoint.sh /usr/local/bin/qbl-entrypoint
RUN chmod +x /usr/local/bin/qbl-entrypoint && mkdir -p /data /shared/public /media-data

EXPOSE 9000
ENTRYPOINT ["qbl-entrypoint"]
CMD ["php-fpm"]
