# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS app
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --strict-ssl=true
COPY --chown=node:node . .
# Auth is initialized while Next collects routes. Use an ephemeral build-only key;
# runtime SESSION_SECRET is supplied by Compose/vault and is never baked into an image.
RUN SESSION_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(40).toString("hex"))')" APP_URL=http://localhost:3000 npm run build && chown -R node:node /app/.next
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["npm", "start"]
