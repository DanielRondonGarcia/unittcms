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
The `fake` mode is for injected tests/dev only and is rejected by the
production entrypoint. MinIO/S3 is optional; configure an `ArtifactStorage`
implementation before using external object storage.

then, you can access the app at `http://localhost:8000`
