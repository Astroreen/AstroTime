# The web app and its CalDAV proxy in one image (docs/plans/foundation.md#D20).
# Run: docker run -p 8080:8080 -e ASTROTIME_PROXY_ALLOW=https://cloud.example.com ghcr.io/astroreen/astrotime

# The build stage runs on the builder's own platform: its output is JavaScript,
# the same for every image, so an arm64 image needs no emulation.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /src
RUN corepack enable
COPY . .
# No lifecycle scripts: `prepare` installs git hooks, which a build has no use for.
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm --filter @astrotime/web build \
  && pnpm --filter @astrotime/proxy build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 ASTROTIME_WEB_ROOT=/app/web
COPY --from=build /src/apps/proxy/dist/main.js /app/server.js
COPY --from=build /src/apps/web/dist /app/web
USER node
EXPOSE 8080
# Shell form, so it checks the port the server was given.
HEALTHCHECK CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "/app/server.js"]
