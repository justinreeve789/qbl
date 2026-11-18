# The "apache" container: the only one reachable from outside.
FROM httpd:2.4-alpine
RUN sed -i \
      -e 's/^#\(LoadModule proxy_module \)/\1/' \
      -e 's/^#\(LoadModule proxy_http_module \)/\1/' \
      -e 's/^#\(LoadModule proxy_fcgi_module \)/\1/' \
      -e 's/^#\(LoadModule proxy_wstunnel_module \)/\1/' \
      -e 's/^#\(LoadModule rewrite_module \)/\1/' \
      -e 's/^#\(LoadModule deflate_module \)/\1/' \
      -e 's/^#\(LoadModule expires_module \)/\1/' \
      conf/httpd.conf \
    && echo 'Include conf/extra/qbl.conf' >> conf/httpd.conf \
    && mkdir -p /var/www/public /var/www/media
COPY qbl.conf conf/extra/qbl.conf
# Writes conf/extra/qbl-public.conf from QBL_PUBLIC_URL each time the container starts.
COPY --chmod=755 public-address.sh /usr/local/bin/qbl-public-address
ENTRYPOINT ["qbl-public-address"]
CMD ["httpd-foreground"]
EXPOSE 80
