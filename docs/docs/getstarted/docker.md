---
sidebar_position: 2
---

# Running UnitTCMS with Docker

First, clone the repository.

```bash
git clone https://github.com/kimatata/unittcms.git
```

Set `SECRET_KEY` outside the repository before starting the stack. The compose
file starts the API with a Redis health dependency and mounts automation
evidence in a private volume separate from legacy public attachments:

```bash
cd unittcms
cp .env.example .env
# Replace SECRET_KEY and any local values in the ignored .env file.
docker compose up --build
```

Automation is fail-closed by default (`AUTOMATION_EXECUTION_MODE=disabled`).
The API Compose service honors an explicit
`AUTOMATION_EXECUTION_MODE=real` in the ignored `.env` file so it can load the
Redis-backed store/resolver and expose project environments. This does not
start the worker or prove real readiness. To execute after independent Phase 0
approval, keep `AUTOMATION_PHASE0_READY=true` and start the separate opt-in
profile:

```bash
docker compose --env-file .env --profile automation-worker up -d --build
```

The `fake` mode is for injected tests/dev only and is rejected by the
production entrypoint. MinIO/S3 is optional; configure an `ArtifactStorage`
implementation before using external object storage.

then, you can access the app at `http://localhost:8000`
