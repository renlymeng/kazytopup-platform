# kazytopup-platform

Custom game top-up platform. Monorepo: `topup-platform/web` (Next.js 14 storefront + admin) and `topup-platform/backend` (NestJS + Prisma/PostgreSQL + Redis/BullMQ). See [`topup-platform/README.md`](topup-platform/README.md) for the full run/deploy and endpoint docs.

## Push to GitHub

```bash
git init -b main
git add -A
git commit -m "Initial commit"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

## Deploy web to Vercel

1. Create/import a project from this repo.
2. Set **Root Directory** to `topup-platform/web` (framework auto-detected: Next.js).
3. Add environment variables (Production — see `topup-platform/web/.env.example`):

   | Key | Value |
   | --- | --- |
   | `API_URL` | public API host, e.g. `https://api.your-site.com` |
   | `NEXT_PUBLIC_TELEGRAM_URL` | your Telegram channel URL |
   | `NEXT_PUBLIC_TELEGRAM_BOT` | your Telegram login bot username |
   | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | (optional) Google OAuth client id |

4. Deploy. `/api/*` is proxied same-origin to `API_URL`, so httpOnly cookies stay first-party.

The backend (api + worker + Postgres + Redis) is **not** deployed to Vercel — it runs on your VPS with `docker compose up -d` (see `topup-platform/README.md` → Deploy).

## CI

`.github/workflows/ci.yml` runs the backend typecheck and a production web build on every push/PR — fix anything it flags before merging.