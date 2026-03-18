# ============================================================================
# Dispute Service Dockerfile
# Multi-stage build for minimal production image
#
# Build context must be the parent directory containing:
#   service/        - dispute-service source
#   shared-types/   - @clipdeck/types package
#   shared-events/  - @clipdeck/events package
# ============================================================================

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

COPY shared-types/ /shared-types/
COPY shared-events/ /shared-events/

COPY service/package*.json ./
COPY service/prisma ./prisma/

RUN cd /shared-events && npm install --production --ignore-scripts 2>&1 | tail -3
RUN npm ci --omit=dev && npx prisma generate

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY shared-types/ /shared-types/
COPY shared-events/ /shared-events/

COPY service/package*.json ./
COPY service/tsconfig.json ./
COPY service/prisma ./prisma/

RUN cd /shared-events && npm install --ignore-scripts 2>&1 | tail -3
RUN cd /shared-events && npm run build
RUN npm ci
RUN npx prisma generate

COPY service/src ./src/
RUN npm run build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Fix CVE-2026-22184: upgrade zlib to patched version
RUN apk upgrade --no-cache zlib

# Add non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 dispute

COPY --from=deps /shared-types/ /shared-types/
COPY --from=builder /shared-events/ /shared-events/
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./

USER dispute

EXPOSE 3009

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3009/health || exit 1

CMD ["node", "dist/index.js"]
