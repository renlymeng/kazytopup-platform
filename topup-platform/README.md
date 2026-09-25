# TopUp: custom game top-up platform

Monorepo: `web/` (Next.js 14 App Router) and `backend/` (NestJS + Prisma/PostgreSQL + Redis/BullMQ).

## Run locally
```bash
docker compose up -d db redis
cd backend && cp .env.example .env   # fill secrets: openssl rand -hex 32
npm i && npx prisma migrate dev --name init && npm run db:seed
npm run dev &  npm run dev:worker &
cd ../web && cp .env.example .env.local && npm i && npm run dev
```
Sign in at `/admin/login` with the seeded super admin; you are forced to enrol TOTP MFA first.

## Deploy
* **web** to Vercel (set `API_URL`, `NEXT_PUBLIC_*`). `/api/*` is proxied same-origin so cookies are first-party.
* **api + worker + Postgres + Redis 7** on a VPS (`docker compose up -d`), behind Cloudflare (orange cloud, firewall the origin to Cloudflare IPs, set `BEHIND_CLOUDFLARE=true`).
* Point `PAYWAY_CALLBACK_URL` at `https://<api-host>/api/webhooks/payway`.

## What you must configure per game (Admin API, JSON)
`lookupConfig` (nickname check) and `deliveryConfig` (delivery), for example:
```json
{ "url": "https://api.your-supplier.com/v1/nickname?game=mlbb&uid={{playerId}}&zone={{serverId}}",
  "method": "GET", "headers": { "Authorization": "Bearer ${ENV:SUPPLIER_API_KEY}" },
  "okPath": "code", "okValue": 200, "resultPath": "data.nickname" }
```
Delivery bodies may use `{{ref}} {{sku}} {{playerId}} {{serverId}}`. Hosts must be in `SUPPLIER_HOST_ALLOWLIST`.

## Endpoints
Public: `GET /api/games`, `GET /api/games/:slug`, `POST /api/lookup`, `POST /api/orders`, `GET /api/orders/:ref`, `POST /api/auth/{google,telegram,logout}`.
Webhook: `POST /api/webhooks/payway`. Admin (cookie + MFA + RBAC): `/api/admin/{auth/*,games,games/:id/toggle,packages,orders,orders/:id/retry,stats,audit}`.
