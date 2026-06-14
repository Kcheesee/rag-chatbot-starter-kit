# Production container for the web app. Multi-stage: build with all deps, then ship
# a pruned (prod-only) image running as a non-root user.
#
#   docker build -f docker/Dockerfile -t rag-chat-agent .
#   docker run -p 3000:3000 --env-file .env rag-chat-agent
#
# For a smaller image, switch the web app to Next.js standalone output
# (`output: "standalone"` + `outputFileTracingRoot`) and copy only `.next/standalone`.

# syntax=docker/dockerfile:1

# ---- Builder ----
FROM node:20-slim AS builder
WORKDIR /app

# Install dependencies against the lockfile first (better layer caching).
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN npm ci

# Build all workspaces (turbo builds the Next app).
RUN npm run build

# ---- Runner ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Run as an unprivileged user.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app ./
# Drop devDependencies from the shipped image.
RUN npm prune --omit=dev

USER nextjs
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace=apps/web"]
