FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY index.js ./

RUN groupadd -r avatar && useradd -r -g avatar -d /app -s /sbin/nologin avatar
RUN mkdir -p /tmp/worker && chown avatar:avatar /tmp/worker /app
USER avatar

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const p=process.env.AVATAR_WORKER_LAST_POLL||'0'; const age=Date.now()-parseInt(p,10); if(age>120000){console.error('stale');process.exit(1)} process.exit(0)"

CMD ["node", "index.js"]
