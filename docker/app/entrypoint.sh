#!/bin/sh
set -e

# An application key is generated once and kept in the app-data volume unless APP_KEY is provided.
if [ -z "$APP_KEY" ]; then
  if [ ! -s /data/app.key ]; then
    php -r 'echo "base64:".base64_encode(random_bytes(32));' > /data/app.key
    chmod 600 /data/app.key
  fi
  APP_KEY="$(cat /data/app.key)"
  export APP_KEY
fi

php artisan migrate --force

# Files uploaded in the editor go to a volume that Apache serves as /media.
if [ -n "$QBL_MEDIA_DIR" ]; then
  mkdir -p "$QBL_MEDIA_DIR"
  chown www-data:www-data "$QBL_MEDIA_DIR"
fi

# Seed the demo mission and publish its JSON. It is seeded once: after that it can be edited like
# any other scenario, and restarting leaves it alone. QBL_SEED=reset restores the shipped version.
if [ "${QBL_SEED:-true}" != "false" ]; then
  php artisan db:seed --force
fi

# Apache serves the static files (the Phaser game, scenario media) straight from this volume.
if [ -d /shared/public ]; then
  find /shared/public -mindepth 1 -delete
  cp -a /app/public/. /shared/public/
fi

chown -R www-data:www-data storage bootstrap/cache
exec "$@"
