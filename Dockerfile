# Digest pins keep the tested base images reproducible across machines.
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Optional corporate/cloud CA is mounted for this step only, never baked in.
# TLS and package-integrity verification stay enabled in both paths.
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then \
      NODE_EXTRA_CA_CERTS=/run/secrets/build_ca npm ci --no-audit --no-fund; \
    else \
      npm ci --no-audit --no-fund; \
    fi
COPY index.html tsconfig.json vite.config.ts ./
COPY src/ ./src/
COPY public/ ./public/
RUN npm run build

FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS api
WORKDIR /app
COPY --chown=10001:10001 server/ ./server/
RUN mkdir -p /data /control && chown -R 10001:10001 /data /control
ENV NODE_ENV=production PORT=9000 ATTENDX_DB_PATH=/data/attendx.db ATTENDX_RUNNER_URL=http://runner:9100
USER 10001:10001
EXPOSE 9000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/api.mjs"]

FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03 AS runtime
COPY --chown=101:101 --chmod=644 docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build --chown=101:101 /app/dist/ /usr/share/nginx/html/
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -Y off -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
STOPSIGNAL SIGQUIT
# The complete config needs no writable entrypoint templates or environment files.
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
