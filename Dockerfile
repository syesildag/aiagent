# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:24.9-alpine3.22 AS builder

WORKDIR /app

# Install system dependencies needed for native addons / node-gyp
RUN apk add --no-cache python3 make g++ openssl gcompat

# Install ALL dependencies (including devDependencies for @swc/cli, @swc/core)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:24.9-alpine3.22

WORKDIR /app

RUN apk add --no-cache openssl gcompat

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy any runtime assets (templates, etc.)
COPY --from=builder /app/src/frontend/templates ./src/frontend/templates

# Expose port (default: 443 for HTTPS, or 3000 if you use HTTP)
EXPOSE 3000

# Start the server
CMD ["npm", "run", "entrypoint"]
