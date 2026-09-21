# syntax=docker/dockerfile:1

# better-sqlite3 ist nativ. Wo npm ci laeuft, muss die Toolchain stehen, sonst
# bricht node-gyp ab. Die Laufzeitstufe bekommt deshalb fertige Module kopiert
# und installiert selbst nichts.
FROM node:24-slim AS werkbank
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

FROM werkbank AS abhaengigkeiten
RUN npm ci --omit=dev

FROM werkbank AS bauer
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim AS laufzeit
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY apps/server/package.json apps/server/
COPY --from=abhaengigkeiten /app/node_modules node_modules
COPY --from=bauer /app/apps/server/dist apps/server/dist
COPY --from=bauer /app/apps/server/spec apps/server/spec
COPY --from=bauer /app/apps/web/dist apps/web/dist

# DATA_DIR muss gesetzt sein, sonst legt die App ihre Datenbank neben den Code
# und das Volume bleibt leer.
ENV PORT=3000 \
    DATA_DIR=/data \
    WEB_DIR=/app/apps/web/dist
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/gesundheit').then(a=>process.exit(a.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
