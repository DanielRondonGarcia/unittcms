# MCP rate-limit configuration

## Objective

Make the `/mcp` rate limiter configurable through environment variables and independently disable-able without disabling MCP or changing the global API limiter semantics.

## Authorized scope

- `backend/config/config.js`
- `backend/mcp/server.ts`
- `backend/server.ts`
- `backend/config/config.test.js`
- `backend/mcp/server.test.ts`
- `docker-compose.yaml`
- `docker-compose.production.yaml`
- `.env.example`
- `deployment-config.test.ts`
- This task document and its Engram mirror

## Constraints

- Preserve `RATE_LIMIT_ENABLED` as the global API limiter switch only.
- Preserve the existing `createMcpRouter` option seam for tests and callers.
- Preserve per-token keying, standard headers, and disabled legacy headers.
- Use false-like values `false`, `0`, `no`, and `off` for the MCP enable flag.
- Keep invalid or missing numeric settings on the existing defaults: `100` requests and `3600000` milliseconds.
- Interpret `MCP_RATE_LIMIT_WINDOW_MS` literally in milliseconds, including `10` as 10 ms.
- Do not commit, push, create a PR, publish an image, or modify remote/deployment state.
- Do not create SDD artifacts.

## Checklist

- [x] MCP-001: parse and expose validated MCP rate-limit settings
- [x] MCP-002: conditionally/configurably register MCP limiter
- [x] MCP-003: propagate/document settings in deployment config and tests
- [x] MCP-004: load `.env` for `services.unittcms` in both official Compose files

## Acceptance criteria

- Missing settings retain the current MCP limiter behavior: enabled, max `100`, window `3600000` ms.
- `MCP_RATE_LIMIT_ENABLED=false`, `0`, `no`, or `off` prevents registration of `express-rate-limit` for `/mcp` while MCP remains registered.
- Enabled MCP uses validated `MCP_RATE_LIMIT_MAX` and `MCP_RATE_LIMIT_WINDOW_MS` values.
- Invalid, non-positive, or non-integer numeric values fall back independently to their defaults.
- Global `RATE_LIMIT_ENABLED` behavior remains unchanged and controls only the API limiter.
- Regression tests cover false-like enablement, invalid numeric fallback, unthrottled MCP, configured MCP, per-token keying, and current headers.
- Both official Compose files and `.env.example` expose safe defaults and document the millisecond unit.
- Both official Compose files declare `services.unittcms.env_file: [.env]` while retaining the existing `environment` interpolation/defaults, with explicit `environment` entries taking precedence.

## Applicable checks

1. `npm test -- --run backend/config/config.test.js backend/mcp/server.test.ts`
2. `npm run format:check`
3. `git diff --check`
4. `git status --short`

## Progress

- Task document created before source changes.
- MCP-001: complete — configuration functions and startup constants now expose validated MCP rate-limit settings.
- MCP-002: complete — MCP registration now conditionally installs the limiter and receives validated startup settings while preserving injected options.
- MCP-003: complete — both official Compose files, `.env.example`, and deployment regression coverage now expose safe MCP rate-limit defaults and the millisecond unit.
- MCP-004: complete — both official Compose files now load `.env` for `services.unittcms`; the existing `environment` interpolation/defaults remain in place and deployment regression coverage verifies both declarations.

## Verification evidence

- `npm test -- --run backend/config/config.test.js`: passed; 1 test file and 7 tests passed.
- `npm test -- --run backend/mcp/server.test.ts`: passed; 1 test file and 7 tests passed.
- `npm test -- --run deployment-config.test.ts`: passed; 1 test file and 8 tests passed.
- `npm test -- --run backend/config/config.test.js backend/mcp/server.test.ts`: passed; 2 test files and 14 tests passed.
- Startup probe with `MCP_RATE_LIMIT_ENABLED=off`, `MCP_RATE_LIMIT_MAX=7`, and `MCP_RATE_LIMIT_WINDOW_MS=10`: emitted `{"MCP_RATE_LIMIT_ENABLED":false,"MCP_RATE_LIMIT_MAX":7,"MCP_RATE_LIMIT_WINDOW_MS":10}`.
- Startup probe with invalid enablement/numeric values: emitted `{"MCP_RATE_LIMIT_ENABLED":true,"MCP_RATE_LIMIT_MAX":100,"MCP_RATE_LIMIT_WINDOW_MS":3600000}`.
- `npm run format:check`: failed with exit 1 because the repository-wide check reported 33 existing formatting issues; the changed implementation files were not among the final command's warnings.
- `git diff --check`: passed with exit 0; Git emitted only LF-to-CRLF normalization warnings for modified files.
- `git status --short`: showed the nine intended modified files plus the untracked `odd/` task directory.
- `npm test -- --run deployment-config.test.ts`: passed; 1 test file and 9 tests passed, including the two official Compose `.env` declarations.
- `npx prettier --check docker-compose.yaml docker-compose.production.yaml deployment-config.test.ts`: failed with exit 1 because the pre-existing long `releaseWorkflow` assertion in `deployment-config.test.ts` remains outside the formatter's style; both Compose files passed the check.

## Next step

Preserve the uncommitted worktree for parent inspection and delivery decisions; no further implementation step remains for this task.
