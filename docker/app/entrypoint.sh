#!/bin/sh
set -e

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

# Apache serves the static files (the marketing page, the Phaser game, scenario media) straight
# from this volume: Laravel's public/ plus the frontend built into the image.
if [ -d /shared/public ]; then
  find /shared/public -mindepth 1 -delete
  cp -a /app/public/. /shared/public/
  cp -a /srv/qbl-public/. /shared/public/
fi

exec "$@"
