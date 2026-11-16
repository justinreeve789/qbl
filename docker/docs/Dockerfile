# The "docs" container: the QBL documentation (docs/), built with MkDocs and served under /docs/.
# Build from the repository root:  docker build -f docker/docs/Dockerfile .

# ---- 1. build ------------------------------------------------------------------------
FROM python:3.12-alpine AS build
RUN pip install --no-cache-dir mkdocs==1.6.1
WORKDIR /src
COPY docs/ .
# Pages link to each other with relative addresses, so the site works under any path.
RUN mkdocs build --strict --site-dir /site

# ---- 2. serve ------------------------------------------------------------------------
FROM httpd:2.4-alpine
RUN printf 'ServerName docs\nServerTokens Prod\nHeader always set X-Content-Type-Options nosniff\n<Directory /usr/local/apache2/htdocs>\n    Options -Indexes\n    AllowOverride None\n    Require all granted\n</Directory>\n' > conf/extra/docs.conf \
    && echo 'Include conf/extra/docs.conf' >> conf/httpd.conf \
    && rm -f htdocs/index.html
COPY --from=build /site/ htdocs/docs/
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1/docs/ > /dev/null || exit 1
