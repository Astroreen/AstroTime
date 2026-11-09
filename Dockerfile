# The web app and its CalDAV proxy in one image (docs/plans/foundation.md#D20).
# Run: docker run -p 8080:8080 -e ASTROTIME_PROXY_ALLOW=https://cloud.example.com ghcr.io/astroreen/astrotime
# Configuration: README.md#self-hosting.
# Base images are pinned by digest, the tag kept to read; Dependabot moves
# both (docs/plans/foundation.md#D41).

# The build stage runs on the builder's own platform: its output is JavaScript,
# the same for every image, so an arm64 image needs no emulation.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8 AS build
WORKDIR /src
RUN corepack enable
COPY . .
# No lifecycle scripts: `prepare` installs git hooks, which a build has no use for.
# Compressing comes last: the server picks a .br/.gz copy by its existence
# alone, so nothing may change apps/web/dist after it (D80).
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm --filter @astrotime/web build \
  && pnpm --filter @astrotime/proxy build \
  && pnpm --filter @astrotime/proxy compress

FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
WORKDIR /app
ENV NODE_ENV=production PORT=8080 ASTROTIME_WEB_ROOT=/app/web
COPY --from=build /src/apps/proxy/dist/main.js /app/server.js
COPY --from=build /src/apps/web/dist /app/web
USER node
EXPOSE 8080
# Shell form, so it checks the port the server was given.
HEALTHCHECK CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "/app/server.js"]
