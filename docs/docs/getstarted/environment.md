---
sidebar_position: 4
---

# Override settings

UnitTCMS will work with the default settings, but you can override them as needed.

:::warning[Strongly Recommended]

It is strongly recommended to change `SECRET_KEY` from the default value in production.

:::

## Docker

If you are self-hosting UnitTCMS with Docker, you can customize the environment using the `environment` section in `docker-compose.yaml`. For a server installation without a source checkout or build, use `docker-compose.production.yaml` and its published GHCR image variables.

```yaml title="docker-compose.yaml"
services:
  unittcms:
    image: unittcms:latest
    build: .
    ports:
      - '8000:8000'
    // highlight-start
    environment:
      - PORT=8000
      - SECRET_KEY=${SECRET_KEY:?set outside source}
      - IS_DEMO=false # set to true to seed the database
      - API_PATH=/api
      - DATABASE_PATH=/app/backend/database/database.sqlite
      - AUTOMATION_EXECUTION_MODE=${AUTOMATION_EXECUTION_MODE:-disabled}
      - AUTOMATION_PHASE0_READY=false
      - AUTOMATION_REDIS_URL=redis://redis:6379
      - AUTOMATION_ARTIFACT_ROOT=/app/backend/private/automation-artifacts
    // highlight-end
    volumes:
      - db-data:/app/backend/database

volumes:
  db-data:
```

## From Source

If you are self-hosting UnitTCMS from source, you can override the environment by placing `.env` files in the appropriate directory.

### Setting frontend environment variables

Create a `.env` file in the `frontend/` directory:

```.env title="frontend/.env"
NEXT_PUBLIC_BACKEND_ORIGIN=http://localhost:8001
```

### Setting backend environment variables

Create a `.env` file in the `backend/` directory:

```.env title="backend/.env"
FRONTEND_ORIGIN=http://localhost:8000
PORT=8001
SECRET_KEY=your-secret-key
```

Automation defaults to `disabled`. For an explicit local/operational API wiring
opt-in, set `AUTOMATION_EXECUTION_MODE=real` in the ignored `.env` file and
recreate the API stack. This enables Redis/store/resolver access and environment
listing only; it does not start the worker or bypass its Phase 0 gate. Use `fake`
only through an injected test or development harness; production startup rejects
it. Real compatibility runs require the published image, an approved HTTP(S)
endpoint, provider authentication when the selected route requires it (Ollama
normally does not), the mandatory UnitTCMS worker secret, and an explicit target
allowlist. Do not put credentials in source, `.env.example`, cases, logs,
screenshots, or evidence.
