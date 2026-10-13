# Happy Steps — production image (Next.js standalone server).
# Build:  docker build -t happy-steps \
#           --build-arg NEXT_PUBLIC_SUPABASE_URL=https://api.example.kz \
#           --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
#           --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY=... .
# Run:    docker run -p 3000:3000 --env-file .env.production happy-steps
#         (or docker compose, see docs/self-hosting.md)
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time; server secrets are runtime env.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
# Optional: 0 disables the service worker in this build (default: on in production builds).
ARG NEXT_PUBLIC_ENABLE_SW=
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_PUBLIC_ENABLE_SW=$NEXT_PUBLIC_ENABLE_SW \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
