---
sidebar_position: 5
draft: true
---

# Deployment

## Production Docker deployment

Use the registry-backed Compose file for a server installation without a source
checkout or build. GHCR packages must be public or the server must authenticate
to `ghcr.io` with a read-only package credential from its secret manager.

```bash
mkdir unittcms-production
cd unittcms-production
curl -fsSLO https://raw.githubusercontent.com/DanielRondonGarcia/unittcms/main/docker-compose.production.yaml
curl -fsSLO https://raw.githubusercontent.com/DanielRondonGarcia/unittcms/main/.env.example
cp .env.example .env
# Edit .env and replace SECRET_KEY outside source control.
docker compose --env-file .env -f docker-compose.production.yaml pull
docker compose --env-file .env -f docker-compose.production.yaml up -d
```

The default command starts UnitTCMS and Redis only. To enable the optional
worker, create its worker-only secret files, pull the child image on the same
Docker host, then start the profile after Phase-0 approval:

```bash
docker pull ghcr.io/danielrondongarcia/testzeus-hercules:latest
docker compose --env-file .env -f docker-compose.production.yaml --profile automation-worker pull
docker compose --env-file .env -f docker-compose.production.yaml --profile automation-worker up -d
```

Hercules is launched as a child container through the read-only Docker socket,
not as a Compose service, and the worker intentionally does not pull it for
each execution. The release workflow publishes both UnitTCMS image targets to
GHCR using `GITHUB_TOKEN`; set `UNITTCMS_IMAGE` and
`UNITTCMS_WORKER_IMAGE` to an exact published version tag when required. Set
`UNITTCMS_UPLOADS_VOLUME` only to a safe Docker volume name when a custom
uploads volume is needed.

## Deploying to Vercel and Render

Deploy the frontend to Vercel and the backend to Render.

### Vercel Configuration

#### Environment Variables

| key                        | value                        |
| -------------------------- | ---------------------------- |
| NEXT_PUBLIC_BACKEND_ORIGIN | `your backend server origin` |

#### Settings

| Settings         | value      |
| ---------------- | ---------- |
| Root Directory   | `frontend` |
| Framework Preset | `Next.js`  |

### Render Configuration

#### Environment Variables

| key             | value                         |
| --------------- | ----------------------------- |
| FRONTEND_ORIGIN | `your frontend server origin` |

#### Settings

| Settings       | value                            |
| -------------- | -------------------------------- |
| Root Directory | `backend`                        |
| Build Command  | `npm install && npm run migrate` |
| Start Command  | `npm run start`                  |
