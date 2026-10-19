FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f
WORKDIR /fixture
COPY --chown=10001:10001 model.mjs ./model.mjs
USER 10001:10001
CMD ["node", "model.mjs"]
