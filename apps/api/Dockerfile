# Elude API. Build context is the REPO ROOT:
#   docker build -f apps/api/Dockerfile -t elude-api .
FROM node:20-alpine
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# Install only the api workspace (+ root) from the lockfile. tsx is a devDependency
# and is used at runtime, so dev deps are kept.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace apps/api --include-workspace-root --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/api apps/api

WORKDIR /app/apps/api
ENV NODE_ENV=production
ENV API_PORT=3210
ENV DATA_DIR=/data
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3210/api/health >/dev/null || exit 1
# The shared package is consumed as TypeScript source, so run through tsx (no build step).
CMD ["npx", "tsx", "src/index.ts"]
