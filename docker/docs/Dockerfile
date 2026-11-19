# The "docs" container: the QBL documentation (docs/), built with Astro Starlight and served under /docs/.
# Build from the repository root:  docker build -f docker/docs/Dockerfile .

# ---- 1. build ------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /src
# The packages first, so editing a page does not reinstall them.
COPY docs/package.json docs/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY docs/ .
# The site lives under /docs (`base` in astro.config.mjs). A broken link fails the build.
RUN npm run build

# ---- 2. serve ------------------------------------------------------------------------
FROM httpd:2.4-alpine
RUN printf 'ServerName docs\nServerTokens Prod\nHeader always set X-Content-Type-Options nosniff\n<Directory /usr/local/apache2/htdocs>\n    Options -Indexes\n    AllowOverride None\n    Require all granted\n</Directory>\n' > conf/extra/docs.conf \
    && echo 'Include conf/extra/docs.conf' >> conf/httpd.conf \
    && rm -f htdocs/index.html
COPY --from=build /src/dist/ htdocs/docs/
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1/docs/ > /dev/null || exit 1
