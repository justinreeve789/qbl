# The "editor" container: the scenario editor, a static web application served under /editor/.
# Build from the repository root:  docker build -f docker/editor/Dockerfile .
#
# It holds no data and no secrets. Everything it does goes through the Laravel API in the "app"
# container, which checks who is asking; Apache puts both behind the same address.

# ---- 1. build ------------------------------------------------------------------------
FROM node:22-alpine AS build
# npm needs git: at least one package in the dependency tree is fetched from a git URL.
RUN apk add --no-cache git
WORKDIR /repo
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY apps/editor/package.json apps/editor/
# Switch to `npm ci` once package-lock.json is committed.
RUN npm install --workspace @qbl/shared --workspace @qbl/editor --include-workspace-root
COPY packages/shared packages/shared
COPY apps/editor apps/editor
# Where "Test this scene" opens the game. Apache serves the game at the root of the same address.
ARG VITE_GAME_URL=/
ENV VITE_GAME_URL=$VITE_GAME_URL
# Bundles without the type-check step, so a typing complaint cannot block the image. Run `npm run typecheck` in CI.
RUN npm exec --workspace @qbl/editor -- vite build

# ---- 2. serve ------------------------------------------------------------------------
FROM httpd:2.4-alpine
COPY docker/editor/editor.conf conf/extra/editor.conf
RUN echo 'Include conf/extra/editor.conf' >> conf/httpd.conf \
    && rm -f htdocs/index.html
COPY --from=build /repo/apps/editor/dist/ htdocs/editor/
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1/editor/ > /dev/null || exit 1
