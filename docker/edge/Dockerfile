# The "edge" container: the only one reachable from the internet. It ends HTTPS (Caddy, with a
# Let's Encrypt certificate or your own) and passes every request to Apache as plain HTTP.
FROM caddy:2-alpine
COPY --chmod=755 edge.sh /usr/local/bin/qbl-edge
# Writes /etc/caddy/Caddyfile from QBL_PUBLIC_URL each time the container starts.
ENTRYPOINT ["qbl-edge"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
EXPOSE 80 443 443/udp
