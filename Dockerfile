# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

LABEL org.opencontainers.image.title="FinForge Web" \
      org.opencontainers.image.description="FinForge React frontend and API gateway" \
      org.opencontainers.image.licenses="MIT"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1

USER 101
