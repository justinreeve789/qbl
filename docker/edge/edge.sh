#!/bin/sh
# Start script for the "edge" container: writes Caddy's configuration from .env, then runs Caddy.
#
# The edge is the only container the internet reaches. It ends HTTPS and hands every request to
# Apache as plain HTTP; everything behind it stays plain HTTP.
#
#   QBL_PUBLIC_URL=https://dev.questlab.cc
#       QBL_TLS_CERT + QBL_TLS_KEY set                             ->  those files are used
#       else fullchain.pem + privkey.pem in the certificate folder ->  those are used
#       else                                                       ->  Let's Encrypt, automatic
#
# The certificate folder is QBL_CERTS_DIR on the host (default ./certs), mounted at /certs.
# QBL_TLS_CERT and QBL_TLS_KEY may be host paths inside it
# (QBL_CERTS_DIR=/etc/letsencrypt, QBL_TLS_CERT=/etc/letsencrypt/live/dev.questlab.cc/fullchain.pem)
# or paths relative to it (live/dev.questlab.cc/fullchain.pem). Mounting the whole folder keeps
# certbot's symlinks (live/ -> archive/) working inside the container.
#     Either way port 80 redirects to https, and the certificate is kept in the edge-data volume.
#   QBL_PUBLIC_URL empty, or http://…  ->  plain HTTP on port 80, no certificate (local try-outs).
set -eu

caddyfile="${QBL_CADDYFILE:-/etc/caddy/Caddyfile}"
certs="${QBL_CERTS:-/certs}"
# The host's name for the certificate folder, so host paths can be translated to /certs.
host_dir=$(printf '%s' "${QBL_CERTS_DIR:-}" | sed -E 's#/+$##')
upstream="${QBL_UPSTREAM:-apache:80}"
url=$(printf '%s' "${QBL_PUBLIC_URL:-}" | tr -d '[:space:]' | tr 'A-Z' 'a-z')
email=$(printf '%s' "${QBL_ACME_EMAIL:-}" | tr -d '[:space:]')

fail() {
  echo "qbl edge: $*" >&2
  exit 1
}

# A certificate path from .env, as the container sees it.
in_container() {
  case "$1" in
    "$host_dir"/*) [ -n "$host_dir" ] && printf '%s' "$certs/${1#"$host_dir"/}" && return ;;
  esac
  case "$1" in
    "$certs"/*) printf '%s' "$1" ;;
    /*) fail "$1 is not inside QBL_CERTS_DIR (${host_dir:-./certs}); set QBL_CERTS_DIR to a folder that contains it, e.g. QBL_CERTS_DIR=/etc/letsencrypt" ;;
    *) printf '%s' "$certs/$1" ;;
  esac
}

case "$url" in
  https://*)
    host=$(printf '%s' "$url" | sed -E 's#^https://([^/?#:]+).*$#\1#')
    printf '%s' "$host" | grep -Eq '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' \
      || fail "QBL_PUBLIC_URL must look like https://dev.questlab.cc (got: $url)"

    tls_cert=$(printf '%s' "${QBL_TLS_CERT:-}" | tr -d '[:space:]')
    tls_key=$(printf '%s' "${QBL_TLS_KEY:-}" | tr -d '[:space:]')
    if [ -n "$tls_cert" ] || [ -n "$tls_key" ]; then
      [ -n "$tls_cert" ] && [ -n "$tls_key" ] || fail "set both QBL_TLS_CERT and QBL_TLS_KEY (or neither)"
      cert_file=$(in_container "$tls_cert") || exit 1
      key_file=$(in_container "$tls_key") || exit 1
      for f in "$cert_file" "$key_file"; do
        case "$f" in *[\{}\"]*) fail "unusual characters in the certificate path: $f" ;; esac
        [ -r "$f" ] || fail "cannot read $f (from QBL_TLS_CERT/QBL_TLS_KEY; QBL_CERTS_DIR=${host_dir:-./certs} is mounted at $certs). If it is a symlink, mount the folder that holds its target too."
      done
      tls="tls $cert_file $key_file"
      how="the certificate $tls_cert"
    elif [ -f "$certs/fullchain.pem" ] && [ -f "$certs/privkey.pem" ]; then
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
