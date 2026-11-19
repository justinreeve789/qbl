#!/bin/sh
set -e
# A failed client build is noticed even though its output is labelled on the way to the log.
set -o pipefail

# /app is apps/api, mounted from the host (docker-compose.yml), so edits go both ways.
#
# PHP-FPM's workers run as www-data. When /app belongs to a user other than root, www-data takes
# that user's ids, so files PHP writes (storage/, bootstrap/cache/, vendor/) stay the host user's.
# "php" itself (artisan, composer) runs as that user too: see php-as-owner.sh.
owner_uid="$(stat -c %u /app)"
owner_gid="$(stat -c %g /app)"
if [ "$owner_uid" != 0 ]; then
  if [ "$(id -g www-data)" != "$owner_gid" ]; then
    groupmod -o -g "$owner_gid" www-data
  fi
  if [ "$(id -u www-data)" != "$owner_uid" ]; then
    usermod -o -u "$owner_uid" -g "$owner_gid" www-data
  fi
fi

# Gives www-data what it must write to. Only files it does not own already are changed, so this is
# quick on later starts. Some bind mounts (Docker Desktop on Windows) refuse chown; they are
# writable by everyone anyway.
own() {
  for dir in "$@"; do
    mkdir -p "$dir"
    find "$dir" \( ! -user www-data -o ! -group www-data \) -exec chown www-data:www-data {} + 2>/dev/null || true
  done
}

# The PHP dependencies live in apps/api/vendor on the host (not committed). Installed here when
# missing, or when composer.lock is newer than them (after a pull that changed it).
if [ ! -f vendor/autoload.php ] || [ composer.lock -nt vendor/composer/installed.json ]; then
  echo "qbl: installing PHP dependencies into apps/api/vendor (composer install)"
  own vendor
  composer install --no-interaction --prefer-dist --optimize-autoloader
fi

# An application key is generated once and kept in the app-data volume unless APP_KEY is provided.
if [ -z "$APP_KEY" ]; then
  if [ ! -s /data/app.key ]; then
    php -r 'echo "base64:".base64_encode(random_bytes(32));' > /data/app.key
    chmod 600 /data/app.key
  fi
  APP_KEY="$(cat /data/app.key)"
  export APP_KEY
fi

# Laravel's own writable folders, and the volumes "php artisan" writes to (generator runs, media).
own storage bootstrap/cache /data/generations
chown www-data:www-data /data
if [ -n "$QBL_MEDIA_DIR" ]; then
  own "$QBL_MEDIA_DIR"
fi

# The tables are brought up to date on every start. Nothing is seeded here: seeding is done by
# hand, when you want it:
#
#   docker compose exec app php artisan qbl:seed            the marketplace catalogue and the demo mission
#   docker compose exec app php artisan qbl:seed --reset    put the shipped demo back, replacing edits to it
php artisan migrate --force

# ---- the client: the marketing page and the Phaser game ------------------------------------------
# Its source is mounted from the host (apps/client, packages/shared, scenarios/assets under /repo).
# Vite builds it into the "public" volume, which Apache serves, next to Laravel's own public/ files.
# With QBL_CLIENT_WATCH=true it keeps watching and rebuilds on every change: reload the page.
label() {
  while IFS= read -r line; do echo "client: $line"; done
}

client() {
  if [ ! -f /repo/apps/client/package.json ]; then
    echo "qbl: no client in /repo/apps/client (is ./apps/client mounted?); the site will have no pages" >&2
    return 0
  fi

  # The client's packages are installed in the "client-modules" volume, apart from any node_modules
  # on the host (which may be for another system). Installed again when a package.json changes.
  stamp="$(cat /repo/package.json /repo/packages/shared/package.json /repo/apps/client/package.json | sha256sum)"
  if [ "$(cat /repo/node_modules/.qbl-installed 2>/dev/null)" != "$stamp" ]; then
    echo "qbl: installing the client's packages (npm install)"
    (cd /repo && npm install --workspace @qbl/shared --workspace @qbl/client --include-workspace-root \
      --no-audit --no-fund --loglevel=warn) || return 1
    echo "$stamp" > /repo/node_modules/.qbl-installed
  fi

  # Built without the type check, so a typing complaint cannot keep the site down. Run
  # "npm run typecheck" on the host or in CI. The output is outside the client's folder, so Vite
  # does not empty it: Laravel's files stay, and in watch mode old bundles stay until a restart.
  if [ "$QBL_CLIENT_WATCH" = true ]; then
    echo "qbl: building the client, then rebuilding it whenever apps/client or packages/shared changes"
    (cd /repo/apps/client && npx vite build --outDir /shared/public --emptyOutDir false --watch --clearScreen false 2>&1 \
      | label) &
  else
    echo "qbl: building the client"
    (cd /repo/apps/client && npx vite build --outDir /shared/public --emptyOutDir false --logLevel warn 2>&1 \
      | label) || return 1
  fi
}

if [ -d /shared/public ]; then
  find /shared/public -mindepth 1 -delete
  cp -a /app/public/. /shared/public/
  client || echo "qbl: the client could not be built (see above); the API runs without it" >&2
fi

exec "$@"
