FROM node:26-alpine AS builder
RUN apk add --no-cache openssl ca-certificates
WORKDIR /app

# Dependency layer — cache-friendly: only rerun when package*.json changes
COPY package*.json ./
COPY patches ./patches/
COPY prisma ./prisma/
RUN npm ci --legacy-peer-deps && npm cache clean --force

# Source & build
COPY . .
# Next.js static generation may call Prisma; provide placeholder build-time env
# (runtime DATABASE_URL comes from the mounted .env / compose env-file).
ENV DATABASE_URL="mysql://build:build@127.0.0.1:3306/build"
ENV AUTH_SECRET="build-time-auth-secret-not-used-at-runtime"
ENV NEXT_PUBLIC_APP_URL="https://workflow.airepro.in"
ENV NEXT_PUBLIC_API_URL="https://workflow.airepro.in/api"
RUN npx prisma generate && npm run build

# Strip devDeps from node_modules after build
# tsx needed at runtime, kept explicitly
RUN npm prune --omit=dev && npm install --no-save tsx typescript

# Production image
FROM node:26-alpine AS runner
RUN apk add --no-cache openssl ca-certificates
WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/scripts ./scripts

ENV NODE_ENV=production
ENV PORT=1730
ENV HOSTNAME=0.0.0.0
EXPOSE 1730

CMD ["sh", "-c", "npx prisma db push && (if [ -n \"$ADMIN_EMAIL\" ] && [ -n \"$ADMIN_PASSWORD\" ]; then node scripts/setup-admin.js \"$ADMIN_EMAIL\" \"$ADMIN_PASSWORD\"; fi) && node node_modules/tsx/dist/cli.mjs src/server/index.ts"]
