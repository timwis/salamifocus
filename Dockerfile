# The app server, with the built web client it serves. Node runs the
# TypeScript sources directly, so only the web client needs a build step.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY domain/package.json domain/
COPY server/package.json server/
COPY web/package.json web/
COPY e2e/package.json e2e/

FROM base AS web
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @salamifocus/web...
COPY domain domain
COPY web web
RUN pnpm --filter @salamifocus/web build

FROM base AS runtime
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter @salamifocus/server...
COPY domain domain
COPY server server
COPY --from=web /app/web/dist web/dist
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100 WEB_ROOT=/app/web/dist
USER node
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3100/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server/src/main.ts"]
