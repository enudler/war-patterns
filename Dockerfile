# ── Stage 1: build the React client ──────────────────────────────────────────
FROM node:20-alpine AS client-build

WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./

# Empty string → axios uses relative URLs (same origin as the server).
ENV VITE_API_URL=
RUN npm run build

# ── Stage 2: production server ────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/src ./src

# Copy the built client so the server can serve it as static files.
COPY --from=client-build /app/client/dist ./public

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "src/index.js"]
