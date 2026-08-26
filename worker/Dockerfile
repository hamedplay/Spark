FROM node:22-slim

WORKDIR /app

RUN groupadd -r avatar && useradd -r -g avatar -d /app -s /sbin/nologin avatar \
  && chown avatar:avatar /app \
  && chmod 0755 /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=avatar:avatar --chmod=0644 index.js healthcheck.js ./

RUN mkdir -p /tmp && chown avatar:avatar /tmp
USER avatar

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node /app/healthcheck.js

CMD ["node", "index.js"]
