<p align="center">
  <a href="https://www.unittcms.org/en">
    <img width="20%" src="https://raw.githubusercontent.com/DanielRondonGarcia/unittcms/refs/heads/main/frontend/public/favicon/icon-192.png" alt="UnitTCMS" />
    <h1 align="center">UnitTCMS</h1>
  </a>
</p>
</br>
<p align="center">
  <a href="https://github.com/DanielRondonGarcia/unittcms/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/DanielRondonGarcia/unittcms" alt="License">
  </a>
  <a href="https://github.com/DanielRondonGarcia/unittcms/releases">
    <img src="https://img.shields.io/github/v/release/DanielRondonGarcia/unittcms" alt="Release">
  </a>
</p>

UnitTCMS is an open source test case management system. The application is free and designed for self-hosted use. It can be used in environments with strict security requirements. For more information, please visit the demo site and docs.

[🧪Demo](https://www.unittcms.org)

[📘Docs](https://kimatata.github.io/unittcms/docs)

## Getting Started

### Local development (builds from source)

Clone the repository, create a local environment file, and start the default
API stack:

```bash
git clone https://github.com/DanielRondonGarcia/unittcms.git
cd unittcms
cp .env.example .env
# Replace SECRET_KEY in .env with a locally generated random value.
docker compose up -d --build
```

On PowerShell, use `Copy-Item .env.example .env` for the copy step. The default
Compose stack starts only the UnitTCMS API/UI and Redis. Automation remains
disabled and fail-closed: the automation worker is not started, regardless of
the LLM profile values in `.env`.

You can access the app at `http://localhost:8000`.

[Looking for a non-Docker way?](https://kimatata.github.io/unittcms/docs/getstarted/from-source)

## Production Docker deployment

The production Compose file uses prebuilt images from GHCR. It does not clone
the source repository or build on the server. The default `up -d` starts only
UnitTCMS and Redis; the automation worker remains opt-in.

Create a deployment directory, download only the Compose file and environment
template, replace `SECRET_KEY` with a strong value, and start the stack:

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

The production defaults are
`ghcr.io/danielrondongarcia/unittcms:latest` and
`ghcr.io/danielrondongarcia/unittcms-automation-worker:latest`. Set
`UNITTCMS_IMAGE` and `UNITTCMS_WORKER_IMAGE` in `.env` to matching published
version tags when an immutable application release is preferred. GHCR packages
must be public for an unauthenticated server; otherwise log in to `ghcr.io`
with a read-only package credential supplied by your secret manager. The
release workflow uses the repository `GITHUB_TOKEN` and requires no new secret.
Database, uploads, private evidence, and automation work use Docker volumes.
Set `UNITTCMS_UPLOADS_VOLUME` only when a different safe Docker volume name is
needed for persisted uploads.

Set `ALLOW_SELF_REGISTRATION=false` to disable new local accounts. The values
`false`, `0`, `no`, and `off` are treated as disabled; existing local and SSO
accounts can still sign in. To bootstrap an administrator, set
`SUPERUSER_EMAIL`; optionally set `SUPERUSER_USERNAME`, which defaults to the
email local-part. `SUPERUSER_PASSWORD` is required only when that email does not
already exist, is bcrypt-hashed at startup, and never replaces an existing
password. If no superuser email is configured, the first signup keeps the
existing administrator behavior.

## MCP access endpoint rollout

The MCP endpoint is disabled by default. Enable it only after the additive
access-token migration has completed and the trusted host list has been set.
The migration preserves existing users, passwords, JWT sign-in, roles, and
non-MCP routes; no token is created implicitly for an existing account.

### Enable MCP safely

1. Back up the database and keep `MCP_ENABLED=false` while applying the
   migration.
2. Run the migration from the application image or source checkout:

   ```bash
   docker compose --env-file .env -f docker-compose.production.yaml run --rm unittcms npm --prefix backend run migrate
   ```

   For a source checkout, the equivalent command is
   `npm --prefix backend run migrate`.

3. Set `MCP_TRUSTED_HOSTS` to a comma-separated list of exact Host header
   values, including ports when they are part of the deployment. Do not use a
   wildcard or a public catch-all host. Set `MCP_ENABLED=true`, then recreate
   the API service.
4. Open account Settings, create an access token with the minimum required
   scope, and save the secret when it is shown. The full secret is shown only
   once; later screens expose metadata only.

MCP clients must call `/api/mcp` with the bearer header below. Query-string tokens
are not supported and are rejected; never put an access token in a URL.

```http
Authorization: Bearer <token>
```

The generated secret is shown only once in Settings. Copy it before dismissing
the notice, then replace the placeholders in this concise MCP initialize request:

```bash
curl --request POST https://<your-host>/api/mcp \
  --header 'Accept: application/json, text/event-stream' \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "<protocol-version>",
      "capabilities": {},
      "clientInfo": {
        "name": "<client-name>",
        "version": "<client-version>"
      }
    }
  }'
```

Tokens expire after their configured 1–90 day lifetime (30 days by default).
Revoking a token from Settings immediately prevents further MCP requests with
that token. A read-only token cannot perform write operations.

### Roll back MCP

To disable the endpoint without changing existing account behavior, set
`MCP_ENABLED=false` and recreate the API service. Keep the additive migration
and token metadata by default so a later re-enable does not destroy lifecycle
history. Only undo the migration after a separate data-retention decision and
database backup; undoing it removes all MCP token metadata and invalidates
every token. Existing non-MCP routes remain available during this rollback.

Hercules is launched by the worker as a child container through the Docker
socket, not as a Compose service. Before enabling the worker, pull its image on
the same Docker host:

```bash
docker pull ghcr.io/danielrondongarcia/testzeus-hercules:latest
```

After creating the mandatory worker secret file and configuring the worker-only
LLM values in `.env`, pull and start the optional profile explicitly:

```bash
docker compose --env-file .env -f docker-compose.production.yaml --profile automation-worker pull
docker compose --env-file .env -f docker-compose.production.yaml --profile automation-worker up -d
```

Set `AUTOMATION_PHASE0_READY=true` only after the separate compatibility proof
has been reviewed. The worker invocation intentionally does not use Docker's
per-execution `--pull`; pre-pull the published Hercules image after upgrades.

## Recent product capabilities

### Layered dark mode

The dark theme uses calm blue-gray surfaces, semantic status colors, consistent
focus states, and darker HeroUI form fields that remain visually distinct from
their surrounding cards. The same treatment applies to inputs, textareas, and
selectors across the application, including folder and authentication dialogs.

### Run workspace improvements

- The case selector fills the available viewport height, including its empty
  state and folder tree.
- The case-detail pane appears with a soft transition without remounting the
  run editor or losing focus.
- A run with no selected case uses the full workspace instead of showing an
  empty right sidebar.
- Gherkin steps, examples tables, execution history, and diagnostics use
  clearer dark-mode hierarchy and softer dividers.

### Reports workspace

Reports can be generated from a selected test execution and either all project
scenarios or an explicit scenario selection. The workspace supports preview and
download output in JSON, HTML, PDF, and DOCX formats using the themed HeroUI
selector and controls.

### Production account policy

Self-registration and automatic OIDC account provisioning can be disabled at
runtime with `ALLOW_SELF_REGISTRATION=false`. A deployment can also bootstrap
or promote one administrator using `SUPERUSER_EMAIL`, with optional
`SUPERUSER_USERNAME` and first-creation-only `SUPERUSER_PASSWORD` values.

## Hercules LLM configuration

The Hercules worker path is opt-in. The API can be explicitly switched to
`real` to connect its Redis-backed store, queue, and environment resolver and
list configured project environments; that setting does not start the worker or
prove execution readiness. Keep the default stack disabled unless this wiring
is intentional, and keep the worker gate closed until the selected provider,
model, project target, and Phase 0 compatibility evidence are ready.

### Quick path

1. Copy `.env.example` to `.env` and keep `.env` out of source control.
2. For local Ollama, set `HERCULES_LLM_PROVIDER=ollama`, copy the exact model tag already installed locally (from `ollama list`) into `HERCULES_LLM_MODEL`, and use `LITELLM_BASE_URL=http://host.docker.internal:11434`. Leave `AUTOMATION_EXECUTION_MODE=disabled` for the safe default; set it explicitly to `real` in `.env` only when the API wiring opt-in is intentional.
3. Create `.secrets/automation_worker_secret` with a locally generated random value. The worker requires this secret even when Ollama does not require provider authentication.
4. For direct Ollama Cloud, set `HERCULES_LLM_PROVIDER=ollama-cloud`, use `LITELLM_BASE_URL=https://ollama.com/api`, set `HERCULES_LLM_MODEL` to the Cloud model name, and create `.secrets/ollama_api_key`. The worker reads the key file only for this provider; never put a key in `.env`, this README, or chat.
5. Create `.secrets/litellm_api_key` only when a keyed LiteLLM gateway/provider route requires it. Local keyless Ollama does not need either provider key file.
6. In the project settings, configure the default Automation Environment base URL. The product worker derives and validates its target allowlist from that saved URL.
7. With `AUTOMATION_EXECUTION_MODE=real`, recreate the API stack with `docker compose --env-file .env up -d --build`. This makes the configured environment available to the API; it does not start the worker, and execution remains not ready without the worker heartbeat.
8. Run the separate Phase 0 compatibility check for the selected provider and project target while the worker is still off. Set `AUTOMATION_PHASE0_READY=true` only after its evidence has been reviewed and approved.
9. Start the complete explicit worker profile with `docker compose --env-file .env --profile automation-worker up -d --build`.

The API `real` value is only the wiring opt-in described above; it does not
bypass Phase 0 or start the worker. The worker profile remains a separate
explicit opt-in and is not a readiness proof. Do not set
`AUTOMATION_PHASE0_READY=true` or start that profile before the compatibility
test succeeds.

The `--build` commands in this local configuration are for development only.
Production uses `docker-compose.production.yaml` and prebuilt registry images.

For local Hercules development, set `AUTOMATION_HERCULES_IMAGE` in `.env` to
one validated image reference such as
`ghcr.io/danielrondongarcia/testzeus-hercules:1.0.1`. Leave it empty to use the
published `ghcr.io/danielrondongarcia/testzeus-hercules:latest` default. This
override is passed only to the opt-in worker; it must not contain whitespace or
shell/argv fragments.

### Provider profiles

OpenAI uses an OpenAI-compatible endpoint exposed through LiteLLM. Set
`HERCULES_LLM_PROVIDER=openai-compatible`, select a model enabled by the
LiteLLM gateway and account, and set `LITELLM_BASE_URL` to the gateway's
reachable base URL. The example models are not guaranteed to be enabled.

The UnitTCMS worker keeps `HERCULES_LLM_PROVIDER`, `HERCULES_LLM_MODEL`,
`LITELLM_BASE_URL`, and the provider-specific file-backed key boundary internally.
`LITELLM_API_KEY_FILE` is used for keyed LiteLLM routes and
`OLLAMA_API_KEY_FILE` is used only by `ollama-cloud`. Immediately before invoking
Hercules, it maps them to `LLM_MODEL_NAME`, `LLM_MODEL_BASE_URL`, and
`LLM_MODEL_API_TYPE`; both Ollama profiles use `LLM_MODEL_API_TYPE=ollama` and
Cloud also receives `LLM_MODEL_API_KEY`. The secret value is supplied through
the child process environment and is never put in Docker argv or logs.

For local Ollama, set `HERCULES_LLM_PROVIDER=ollama` and use the exact tag shown
by `ollama list` for `HERCULES_LLM_MODEL`. Docker Desktop containers normally
reach the host Ollama service at `http://host.docker.internal:11434`. On Linux,
that hostname may require extra Docker host mapping or a different host/IP that
is reachable from the worker.

Ollama does not require a provider API key, but the worker still requires
`AUTOMATION_WORKER_SECRET` through its mandatory secret file. Keep the optional
file-based LLM secret boundaries separate: use `litellm_api_key` for a keyed
gateway and `ollama_api_key` for direct Ollama Cloud.

For direct Ollama Cloud, the endpoint must be exactly `https://ollama.com/api`
(a trailing slash is normalized), without URL credentials, query parameters, or
fragments. Production requires `OLLAMA_API_KEY_FILE=/run/secrets/ollama_api_key`.
When `OLLAMA_API_KEY_FILE` is unset, the `OLLAMA_API_KEY` environment fallback is
for non-production local tests only.

### Model examples

These are starting examples, not guarantees of availability or suitability. The
local Ollama value must be an exact installed tag, while the Cloud value must be
an available Ollama Cloud model name. Do not use a guessed model name.

| Scenario                                   | Example models                                  | Guidance                                                                                       |
| ------------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Text-only navigation and simple assertions | `gpt-4o-mini`, `qwen2.5:7b`, `llama3.1:8b`      | Usually lower cost and latency; use when screenshots or image interpretation are not required. |
| Vision and multimodal interpretation       | `gpt-4o`, `llama3.2-vision:11b`, `qwen2.5vl:7b` | Use only for scenarios that need screenshots, layout, charts, or other visual evidence.        |

Actual availability depends on gateway/account access, Ollama model names,
local Ollama tags, provider limits, license, cost, latency, and the real Hercules
contract.

Selecting a vision-capable model does not create images or automatically send
screenshots. Hercules must produce and send the evidence, and the provider
must support the request. Visual captchas may remain non-automatable; choosing
vision is not a promise that they will work.

### Execution gates

`AUTOMATION_EXECUTION_MODE` has three meanings:

| Value      | Meaning                                                                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disabled` | No automation execution. This is the safe default and remains fail-closed.                                                                                                                                             |
| `fake`     | Use only an injected deterministic executor for tests or development; it does not run real Hercules or an LLM.                                                                                                         |
| `real`     | Explicitly enable the Redis/store/resolver API runtime; the separate opt-in worker also uses `real` for real Hercules/LLM execution, which requires approved Phase 0 evidence and valid provider/target configuration. |

The API Compose service uses
`AUTOMATION_EXECUTION_MODE=${AUTOMATION_EXECUTION_MODE:-disabled}`. With no
explicit override, the API remains disabled and fail-closed. To expose the
configured project environments through the real API wiring, set
`AUTOMATION_EXECUTION_MODE=real` in `.env` and recreate the API stack. This
does not start the worker or claim real execution readiness. The opt-in worker
profile independently sets `real` and still requires the Phase 0 gate.

`AUTOMATION_PHASE0_READY=false` keeps the worker from consuming real jobs.
Change it to `true` only after the isolated Phase 0 compatibility evidence is
approved. This flag is a gate, not a replacement for provider authentication
when required, model availability, target binding, or end-to-end proof.

### Privileged boundary

The Docker socket is mounted only by the opt-in `automation-worker` service,
and the mount is read-only. Access to `/var/run/docker.sock` is still a
privileged boundary because the worker can control the host Docker daemon.
Treat this profile as a trusted, isolated execution surface and do not enable
it by accident.

### Verification status

Compose parsing and image builds verify configuration and buildability only.
They do not prove that real Hercules/LLM execution is ready, that the selected
provider accepts the model, or that screenshot evidence and end-to-end runs
work. Real readiness requires the separate Phase 0 compatibility evidence.

## Why UnitTCMS

There are many test case management tools available in the market, which can be categorized into proprietary and open-source solutions.

Proprietary tools often come with modern, user-friendly interfaces but tend to be cloud-based, which may raise security concerns for some organizations. While some of them do offer on-premises options, these tend to be significantly more expensive.

There are also open-source tools, but many feature older user interfaces that involve frequent full page reloads, which can hinder usability.

With these challenges in mind, I set out to develop a modern, user-friendly, open-source test case management tool that anyone can use for free in a secure, self-hosted environment.

## Features

### Project-Based

Manage test cases and test runs on a project-by-project basis. Our dashboard provides an at-a-glance view of the types of test cases and their progress for each project. This allows you to monitor project status in real-time and manage efficiently.

![Project-Based](./frontend/public/top/light/project.png)

<hr />

### Test case management

Create folders within projects and define test cases with ease using our modern and intuitive UI. Attaching files enables detailed explanations of test cases, making it easy to share information across the entire team.

![Test Case Management](./frontend/public/top/light/case.png)

<hr />

### Test run management

Defined test cases can be reused multiple times in test runs, enabling efficient test cycles. Additionally, you can visually monitor the status of test runs and projects.

![Test Run Management](./frontend/public/top/light/run.png)

<hr />

### Project member management

Support team development by adding or removing members from projects. You can assign roles and set permissions for each member in detail. We provide three main roles: 'Manager' who manages the entire project, 'Developer' who designs the tests, and 'Reporter' who executes the tests.

![Member Management](./frontend/public/top/light/member.png)

## Supported Languages

UnitTCMS currently supports the following languages:

- German (de)
- English (en)
- Spanish (es)
- Portuguese (pt-BR)
- Chinese (zh-CN)
- Japanese (ja)

If you would like to add support for another language, feel free to submit a pull request. For reference, you can see how Portuguese was added in [PR #260](https://github.com/kimatata/unittcms/pull/260).
