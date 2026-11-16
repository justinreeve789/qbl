# The "colyseus" container: the multiplayer game server.
# Build from the repository root:  docker build -f docker/colyseus/Dockerfile .
FROM node:22-alpine
# npm needs git: at least one package in the dependency tree is fetched from a git URL.
RUN apk add --no-cache git
WORKDIR /repo
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY apps/editor/package.json apps/editor/
# Switch to `npm ci` once package-lock.json is committed.
RUN npm install --workspace @qbl/shared --workspace @qbl/server --include-workspace-root
COPY packages/shared packages/shared
COPY apps/server apps/server

# Runs the TypeScript directly with tsx, as `npm run dev` does. To run compiled JavaScript instead:
#   npm run build -w @qbl/shared && npm run build -w @qbl/server, then `node dist/index.js`.
ENV NODE_ENV=production PORT=2567
RUN mkdir -p /data/saves && chown -R node:node /data
USER node
WORKDIR /repo/apps/server
EXPOSE 2567
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:2567/healthz || exit 1
CMD ["node", "--import", "tsx", "src/index.ts"]
