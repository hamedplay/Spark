FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY index.js healthcheck.js ./

RUN groupadd -r avatar && useradd -r -g avatar -d /app -s /sbin/nologin avatar
RUN mkdir -p /tmp && chown avatar:avatar /tmp /app
USER avatar

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node /app/healthcheck.js

CMD ["node", "index.js"]
