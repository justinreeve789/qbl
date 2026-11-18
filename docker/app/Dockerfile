# The "app" container: the Laravel backend (PHP-FPM), the built Phaser frontend and the marketing page.
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
# The marketing page's characters are the platform avatars.
COPY scenarios/assets/platform scenarios/assets/platform
# login: email + password against Laravel, with a "play as guest" link.
ARG VITE_AUTH_MODE=login
ARG VITE_DEFAULT_SCENARIO=starshipexplorer
ENV VITE_AUTH_MODE=$VITE_AUTH_MODE VITE_DEFAULT_SCENARIO=$VITE_DEFAULT_SCENARIO
# Bundles without the type-check step, so a typing complaint cannot block the image. Run `npm run typecheck` in CI.
RUN npm exec --workspace @qbl/client -- vite build

# ---- 2. Laravel + the frontend in its public directory -------------------------------
FROM php:8.4-fpm-alpine

# zip: scenarios are exported and imported as ZIP files (App\Qbl\ScenarioArchive).
# gd: the AI scenario generator cuts out, sizes and colour-matches pictures (App\Qbl\Generation\Art\ImageTools).
RUN apk add --no-cache git unzip libzip-dev libpng-dev libjpeg-turbo-dev libwebp-dev freetype-dev \
    && docker-php-ext-configure gd --with-jpeg --with-webp --with-freetype \
    && docker-php-ext-install pdo_mysql opcache zip gd
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app
# apps/api is a complete Laravel application. Dependencies come from its composer.lock, so every
# build installs the same versions. They are installed before the code is copied so that this
# layer is reused until composer.json or composer.lock changes.
COPY apps/api/composer.json apps/api/composer.lock ./
RUN composer install --no-interaction --no-dev --prefer-dist --no-scripts --no-autoloader
COPY apps/api/ /app/
RUN composer dump-autoload --optimize --no-dev

# The marketing page (index.html), the game (play.html) and their bundles sit beside Laravel's index.php, and scenario media beside them.
COPY --from=frontend /repo/apps/client/dist/ /app/public/
COPY scenarios/assets/ /app/public/scenario-assets/

COPY docker/app/php.ini /usr/local/etc/php/conf.d/qbl.ini
COPY docker/app/entrypoint.sh /usr/local/bin/qbl-entrypoint
RUN chmod +x /usr/local/bin/qbl-entrypoint && mkdir -p /data /shared/public /media-data

EXPOSE 9000
ENTRYPOINT ["qbl-entrypoint"]
CMD ["php-fpm"]
