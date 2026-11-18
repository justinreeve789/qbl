#!/bin/sh
# Start script for the "db" container (MariaDB): keeps the application's database account in step
# with .env, then runs the image's own entrypoint.
#
# The MariaDB image applies MARIADB_USER / MARIADB_PASSWORD only when its data volume is created.
# Change DB_PASSWORD in .env afterwards and Laravel gets "Access denied for user 'qbl'". So, once
# the volume exists, this hands the server an --init-file (SQL the server runs at every start,
# with full privileges; MariaDB's documented way to reset a password) that sets the account's
# password to the current one, creates the account and database if missing, and grants it the
# database. The very first start is left to the image, which creates them itself.
set -eu

datadir="${QBL_DB_DATADIR:-/var/lib/mysql}"
initfile="${QBL_DB_INITFILE:-/run/qbl-db/sync-password.sql}"
user="${MARIADB_USER:-${MYSQL_USER:-}}"
password="${MARIADB_PASSWORD:-${MYSQL_PASSWORD:-}}"
database="${MARIADB_DATABASE:-${MYSQL_DATABASE:-}}"
host="${MARIADB_USER_HOST:-%}"

# The image's command line: options alone mean "mariadbd with these options".
case "${1:-}" in
  -* | "") set -- mariadbd "$@" ;;
esac

if [ -d "$datadir/mysql" ] && [ -n "$user" ] && [ -n "$password" ] && [ -n "$database" ] \
  && { [ "$1" = mariadbd ] || [ "$1" = mysqld ]; }; then
  for name in "$user" "$database" "$host"; do
    printf '%s' "$name" | grep -Eq '^[A-Za-z0-9_.%-]+$' \
      || { echo "qbl db: unexpected characters in a database or account name: $name" >&2; exit 1; }
  done
  # A string literal for SQL: backslashes and single quotes escaped.
  quoted=$(printf '%s' "$password" | sed -e 's/\\/\\\\/g' -e "s/'/\\\\'/g")

  mkdir -p "$(dirname "$initfile")"
  umask 077
  cat > "$initfile" <<EOF
CREATE DATABASE IF NOT EXISTS \`$database\`;
CREATE USER IF NOT EXISTS '$user'@'$host' IDENTIFIED BY '$quoted';
ALTER USER '$user'@'$host' IDENTIFIED BY '$quoted';
GRANT ALL PRIVILEGES ON \`$database\`.* TO '$user'@'$host';
EOF
  # The server reads it after dropping to the mysql user.
  chown mysql:mysql "$initfile" "$(dirname "$initfile")" 2>/dev/null || true
  echo "qbl db: the password of '$user' follows DB_PASSWORD in .env" >&2
  set -- "$@" "--init-file=$initfile"
fi

exec docker-entrypoint.sh "$@"
