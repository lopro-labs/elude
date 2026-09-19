# Elude — web app
# Build context must be the REPO ROOT:
#   docker build -f apps/web/Dockerfile -t elude-web .
# syntax=docker/dockerfile:1

# ---- build stage ---------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
ARG VITE_API_BASE=/api
ENV VITE_MAP_STYLE_URL=$VITE_MAP_STYLE_URL \
    VITE_API_BASE=$VITE_API_BASE

# Workspace manifests first for better layer caching.
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
# The api workspace is referenced by the root package.json workspaces glob;
# copy just its manifest so `npm ci` can resolve the lockfile.
COPY apps/api/package.json apps/api/

# Install with devDependencies (vite, tsc) — NODE_ENV is left unset here so npm
# does not prune them.
RUN npm ci --include=dev --no-audit --no-fund --ignore-scripts

COPY packages/shared packages/shared
COPY apps/web apps/web

# Build in production mode so Vite emits a production bundle (React prod runtime,
# import.meta.env.DEV = false). A dev bundle would leave debug-only UI enabled.
RUN NODE_ENV=production npm run build -w apps/web

# ---- runtime stage -------------------------------------------------------
FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
