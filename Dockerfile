# C7 Automation OS: Core server (the WhatsApp /webhook and /cron/* endpoints).
# Host-agnostic container. Runs the TypeScript source via tsx so the client and
# vertical asset paths resolve the same way they do in dev.
FROM node:20-slim

WORKDIR /app

# Install dependencies first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source and assets (clients/, verticals/ are read at runtime).
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Health check hits the liveness endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
