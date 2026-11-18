#!/bin/sh
# Start script for the "apache" container: writes conf/extra/qbl-public.conf from QBL_PUBLIC_URL,
# then runs Apache.
#
# With QBL_PUBLIC_URL set (https://dev.questlab.cc, say), that address is the site's own name.
# Every address Apache writes itself (redirects, and the editor's and docs' redirects it passes
# on) uses it, whatever Host header and X-Forwarded-Proto reach it, or don't.
# Unset, addresses follow each request, which suits trying it out on localhost or a LAN address.
set -eu

conf="${QBL_PUBLIC_CONF:-/usr/local/apache2/conf/extra/qbl-public.conf}"
url=$(printf '%s' "${QBL_PUBLIC_URL:-}" | tr -d '[:space:]' | tr 'A-Z' 'a-z')

if [ -z "$url" ]; then
  echo '# QBL_PUBLIC_URL is not set: addresses follow each request (its Host and X-Forwarded-Proto).' > "$conf"
else
  # Scheme, host and port only: a path or trailing slash is dropped.
  origin=$(printf '%s' "$url" | sed -E 's#^(https?://[^/?#]+).*$#\1#')
  if ! printf '%s' "$origin" | grep -Eq '^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$'; then
    echo "qbl: QBL_PUBLIC_URL must look like https://dev.questlab.cc (got: $url)" >&2
    exit 1
  fi
  {
    echo "# Written when the container started, from QBL_PUBLIC_URL=$url"
    echo "ServerName $origin"
    echo 'UseCanonicalName On'
    echo 'SetEnvIf Request_Method "." QBL_CANONICAL=1'
    case "$origin" in
      https://*) echo 'SetEnvIf Request_Method "." QBL_HTTPS=1' ;;
    esac
  } > "$conf"
  echo "qbl: public address $origin" >&2
fi

exec "$@"
