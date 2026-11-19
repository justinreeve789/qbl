#!/bin/sh
# Installed as /usr/local/sbin/php, ahead of the real /usr/local/bin/php in PATH.
#
# /app is apps/api mounted from the host. Anything php writes there (vendor/ from composer,
# storage/, bootstrap/cache/) must belong to the host's user, or the host can no longer run
# composer and artisan itself. So when root runs php (as "docker compose exec app php artisan ..."
# and "docker compose exec app composer ..." do), it runs as the owner of /app instead.
#
# Nothing changes when /app belongs to root (a checkout owned by root, or Docker Desktop on Windows).
# QBL_PHP_AS_ROOT=1 keeps root:  docker compose exec -e QBL_PHP_AS_ROOT=1 app php ...
if [ "$(id -u)" = 0 ] && [ -z "$QBL_PHP_AS_ROOT" ]; then
  owner="$(stat -c %u:%g /app 2>/dev/null || echo 0:0)"
  case "$owner" in
    0:*) ;;
    *) exec su-exec "$owner" /usr/local/bin/php "$@" ;;
  esac
fi
exec /usr/local/bin/php "$@"
