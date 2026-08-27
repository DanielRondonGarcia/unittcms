<p align="center">
  <a href="https://www.unittcms.org/en">
    <img width="20%" src="https://raw.githubusercontent.com/kimatata/unittcms/refs/heads/main/frontend/public/favicon/icon-192.png" alt="UnitTCMS" />
    <h1 align="center">UnitTCMS</h1>
  </a>
</p>
</br>
<p align="center">
  <a href="https://github.com/kimatata/unittcms/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/kimatata/unittcms" alt="License">
  </a>
  <a href="https://github.com/kimatata/unittcms/releases">
    <img src="https://img.shields.io/github/v/release/kimatata/unittcms" alt="Release">
  </a>
</p>

UnitTCMS is an open source test case management system. The application is free and designed for self-hosted use. It can be used in environments with strict security requirements. For more information, please visit the demo site and docs.

[🧪Demo](https://www.unittcms.org)

[📘Docs](https://kimatata.github.io/unittcms/docs)

## Getting Started

Clone the repository, create a local environment file, and start the default
API stack:

```bash
git clone https://github.com/kimatata/unittcms.git
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

For local Hercules development, set `AUTOMATION_HERCULES_IMAGE` in `.env` to
one validated image reference such as `testzeus/hercules:0.1.2-amd64`. Leave it
empty to retain the official pinned digest. This override is passed only to the
opt-in worker; it must not contain whitespace or shell/argv fragments.

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
- Portuguese (pt-BR)
- Chinese (zh-CN)
- Japanese (ja)

If you would like to add support for another language, feel free to submit a pull request. For reference, you can see how Portuguese was added in [PR #260](https://github.com/kimatata/unittcms/pull/260).
