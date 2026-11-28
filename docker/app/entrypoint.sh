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
  while IFS= read -r line; do echo "$1: $line"; done
}

# build <name> <folder under /repo/apps> <where the result goes>
# --configLoader runner: Vite reads its config without writing a temporary file beside it, which
# it cannot do in a read-only mount (it fails outright when the host has a node_modules there).
build() {
  if [ "$QBL_CLIENT_WATCH" = true ]; then
    echo "qbl: building the $1, then rebuilding it whenever its source or packages/shared changes"
    (cd "/repo/apps/$2" && npx vite build --configLoader runner --outDir "$3" --emptyOutDir false --watch --clearScreen false 2>&1 \
      | label "$1") &
  else
    echo "qbl: building the $1"
    (cd "/repo/apps/$2" && npx vite build --configLoader runner --outDir "$3" --emptyOutDir false --logLevel warn 2>&1 \
      | label "$1") || return 1
  fi
}

# The npm packages of the client and the editor are installed in the "client-modules" volume, apart
# from any node_modules on the host (which may be for another system). Installed again when a
# package.json changes: at start, and with the watcher on, also while running (see below).
manifests() {
  m="/repo/package.json /repo/packages/shared/package.json /repo/apps/client/package.json"
  [ -f /repo/apps/editor/package.json ] && m="$m /repo/apps/editor/package.json"
  echo "$m"
}
packages_stamp() {
  cat $(manifests) | sha256sum
}
packages_current() {
  [ "$(cat /repo/node_modules/.qbl-installed 2>/dev/null)" = "$(packages_stamp)" ]
}
packages() {
  workspaces="--workspace @qbl/shared --workspace @qbl/client"
  [ -f /repo/apps/editor/package.json ] && workspaces="$workspaces --workspace @qbl/editor"
  stamp="$(packages_stamp)"
  if ! packages_current; then
    echo "qbl: installing the client's and the editor's packages (npm install)"
    (cd /repo && npm install $workspaces --include-workspace-root --no-audit --no-fund --loglevel=warn) || return 1
    echo "$stamp" > /repo/node_modules/.qbl-installed
  fi
}

# Apache serves Laravel's own public/ files from the same volume as the client.
if [ -d /shared/public ]; then
  find /shared/public -mindepth 1 -delete
  cp -a /app/public/. /shared/public/
fi
[ -d /shared/editor ] && find /shared/editor -mindepth 1 -delete

# Built without the type check, so a typing complaint cannot keep the site down. Run
# "npm run typecheck" on the host or in CI. The output is outside the source folders, so Vite does
# not empty it: in watch mode old bundles stay until a restart, when both were emptied above.
build_all() {
  if [ -d /shared/public ]; then
    build client client /shared/public || echo "qbl: the client could not be built (see above); the API runs without it" >&2
  fi
  # The editor, for the "editor" container. "Test this scene" opens the game at the same address.
  if [ -d /shared/editor ] && [ -f /repo/apps/editor/package.json ]; then
    VITE_GAME_URL="${VITE_GAME_URL:-/}" build editor editor /shared/editor || echo "qbl: the editor could not be built (see above); /editor has no page" >&2
  fi
}

if [ ! -f /repo/apps/client/package.json ]; then
  echo "qbl: no client in /repo/apps/client (is ./apps/client mounted?); the site will have no pages" >&2
elif ! packages; then
  echo "qbl: the packages could not be installed (see above); the API runs without the client and the editor" >&2
else
  build_all
fi

# With the watcher on, a "git pull" that adds a package would otherwise break every rebuild until
# the next restart (the import cannot be found), and Vite would quietly keep serving the build from
# before the pull. So the package.json files are checked every 15 seconds: when one has changed, the
# watchers are stopped, the packages installed, and the watchers started again.
if [ "$QBL_CLIENT_WATCH" = true ] && [ -f /repo/apps/client/package.json ]; then
  (while sleep 15; do
    packages_current && continue
    echo "qbl: a package.json changed; installing the packages again, then restarting the builds"
    pkill -f 'vite build' 2>/dev/null || true
    sleep 1
    if packages; then
      build_all
    else
      echo "qbl: the packages could not be installed (see above); trying again in 15 seconds" >&2
    fi
  done) &
fi

# ---- the queue worker ------------------------------------------------------------------------------
# Work that takes minutes runs here, not in a web request: missions from the editor's AI generator,
# and the district admin panel's roster syncs (Clever, Google Classroom). Restarted if it stops.
# QBL_QUEUE_WORKER=false turns it off (run "php artisan queue:work" elsewhere instead).
if [ "${QBL_QUEUE_WORKER:-true}" = true ]; then
  echo "qbl: starting the queue worker (AI missions, roster syncs)"
  (while true; do
    php artisan queue:work --tries=1 --timeout=3600 --sleep=3 --memory=2048 2>&1 | label worker
    sleep 5
  done) &
fi

exec "$@"
