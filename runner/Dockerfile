FROM docker:28-cli@sha256:625d9431a9f54c5a2bc90f24f0e1c3d55b1349fd857dd85035f98c2c9acbdd4d AS docker-cli
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY runner/server.mjs runner/harness-node.mjs runner/harness-python.mjs ./runner/
RUN chmod 755 /app/runner && chmod 444 /app/runner/*.mjs
# The broker alone needs the Docker socket. Compose removes its capabilities,
# grants only the socket/control-file groups, and makes its root filesystem RO.
# Generated jobs never receive that socket, control key or host bind mounts.
EXPOSE 9100
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:9100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "runner/server.mjs"]
