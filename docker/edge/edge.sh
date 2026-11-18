#!/bin/sh
# Start script for the "edge" container: writes Caddy's configuration from .env, then runs Caddy.
#
# The edge is the only container the internet reaches. It ends HTTPS and hands every request to
# Apache as plain HTTP; everything behind it stays plain HTTP.
#
#   QBL_PUBLIC_URL=https://dev.questlab.cc
#       certificate files in /certs (fullchain.pem + privkey.pem)  ->  those are used
#       no certificate files                                       ->  Let's Encrypt, automatic
#     Either way port 80 redirects to https, and the certificate is kept in the edge-data volume.
#   QBL_PUBLIC_URL empty, or http://…  ->  plain HTTP on port 80, no certificate (local try-outs).
set -eu

caddyfile="${QBL_CADDYFILE:-/etc/caddy/Caddyfile}"
certs="${QBL_CERTS:-/certs}"
upstream="${QBL_UPSTREAM:-apache:80}"
url=$(printf '%s' "${QBL_PUBLIC_URL:-}" | tr -d '[:space:]' | tr 'A-Z' 'a-z')
email=$(printf '%s' "${QBL_ACME_EMAIL:-}" | tr -d '[:space:]')

fail() {
  echo "qbl edge: $*" >&2
  exit 1
}

case "$url" in
  https://*)
    host=$(printf '%s' "$url" | sed -E 's#^https://([^/?#:]+).*$#\1#')
    printf '%s' "$host" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' \
      || fail "QBL_PUBLIC_URL must look like https://dev.questlab.cc (got: $url)"

    if [ -f "$certs/fullchain.pem" ] && [ -f "$certs/privkey.pem" ]; then
      tls="tls $certs/fullchain.pem $certs/privkey.pem"
      how="the certificate in $certs (fullchain.pem, privkey.pem)"
    elif [ -f "$certs/fullchain.pem" ] || [ -f "$certs/privkey.pem" ]; then
      fail "$certs needs both fullchain.pem and privkey.pem (or neither, for Let's Encrypt)"
    else
      tls=""
      how="a Let's Encrypt certificate, fetched and renewed automatically"
      # Let's Encrypt checks the site on public port 80 or 443.
      if [ "${QBL_HTTP_PORT:-80}" != 80 ] && [ "${QBL_HTTPS_PORT:-443}" != 443 ]; then
        echo "qbl edge: warning: Let's Encrypt needs public port 80 or 443; set QBL_HTTP_PORT=80 and QBL_HTTPS_PORT=443" >&2
      fi
    fi

    global=""
    if [ -n "$email" ]; then
      printf '%s' "$email" | grep -Eq '^[^@{}"]+@[^@{}"]+$' || fail "QBL_ACME_EMAIL is not an email address (got: $email)"
      global="email $email"
    fi

    cat > "$caddyfile" <<EOF
# Written when the container started, from QBL_PUBLIC_URL=$url
{
	$global
}

$host {
	$tls
	reverse_proxy $upstream
}
EOF
    echo "qbl edge: https://$host with $how" >&2
    ;;

  http://* | "")
    cat > "$caddyfile" <<EOF
# Written when the container started: QBL_PUBLIC_URL is ${url:-empty}, so plain HTTP, no certificate.
{
	auto_https off
}

:80 {
	reverse_proxy $upstream
}
EOF
    echo "qbl edge: plain http on port 80 (set QBL_PUBLIC_URL=https://… for HTTPS)" >&2
    ;;

  *)
    fail "QBL_PUBLIC_URL must start with https:// or http:// (got: $url)"
    ;;
esac

exec "$@"
