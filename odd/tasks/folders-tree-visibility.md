# Folders tree visibility

## Objective

Keep the project folder tree visible and usable when the pane is resized or its parent height is temporarily unresolved.

## Problem

`FoldersPane` measures the tree container with `ResizeObserver` and passes `Math.max(measuredHeight, 1)` to `react-arborist`. A zero measurement therefore renders the tree at roughly one pixel, making existing folders appear missing or clipped. Folder-fetch failures are also swallowed by the control layer, leaving the same blank visual state without a diagnostic.

## Why

QA shows the cases list working while the folder column is blank or contains clipped elements. The folder records are likely present; the tree needs a safe initial measurement and a visible failure path.

## Scope

- Add a non-zero, conservative initial tree height and preserve later measured dimensions.
- Ignore transient zero measurements instead of replacing a usable fallback with `1px`.
- Keep the existing project layout, folder data contract, drag/drop move events, and folder CRUD behavior unchanged.
- Add focused pure coverage if the sizing fallback is extracted; otherwise run changed-file checks and local container validation.

## Constraints

- Do not change folder persistence or API contracts.
- Do not hide real fetch failures; preserve existing logging and surface only a safe UI state if implemented.
- Do not touch the case reorder UI or unrelated files.
- Technical artifacts and code comments remain in English.

## Authorized scope

- `frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx`
- Focused folder-tree tests if needed.
- `odd/tasks/folders-tree-visibility.md` and its Engram mirror.

## Tasks

- [x] TREE-001 Make tree sizing resilient to zero/initial measurements.
- [x] TREE-002 Run focused frontend checks, rebuild local Docker, and record the result.

## Acceptance criteria

- Existing folder rows render when the tree container is temporarily measured at zero.
- A later positive `ResizeObserver` measurement updates the tree dimensions.
- The tree is not intentionally rendered at `1px` as a fallback.
- Cases, folder CRUD, move events, and project layout behavior remain unchanged.
- Local health and changed-file checks pass.

## Checks

- `npx tsc --noEmit -p frontend/tsconfig.json`
- `npx eslint "frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx"`
- `npx prettier --check "frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx"`
- `git diff --check`
- `docker compose build`
- `docker compose up -d`
- `GET http://localhost:8000/api/health/`

## Progress

- Diagnosis completed from QA screenshots and current source.
- The case reorder commit does not modify `FoldersPane`; the likely regression surface is the full-height parent chain plus the tree's `1px` zero-measurement fallback.
- TREE-001 implemented in `frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx`: the tree now starts at the named `MIN_TREE_HEIGHT` fallback of 192px, ignores measurements below `MIN_VALID_TREE_HEIGHT` (2px), preserves positive `ResizeObserver` updates, and uses Tailwind `min-h-48` to keep the container from collapsing while the flex chain settles.
- The requested focused checks passed; independent verification found no blocking source issue.
- TREE-002 completed: the local image was rebuilt, Docker Compose recreated `unittcms` and Redis, both services are healthy, and the health endpoint returned HTTP 200.

## Verification evidence

- Changed file: `frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx`
- `npx tsc --noEmit -p frontend/tsconfig.json`: passed, exit code 0, no output.
- `npx eslint "frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx"`: passed, exit code 0, no output.
- `npx prettier --check "frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx"`: passed, output `All matched files use Prettier code style!`.
- `git diff --check`: passed, exit code 0; Git emitted the line-ending warning that LF will be replaced by CRLF the next time it touches the file.
- No Docker, browser, backend, MCP, API, CRUD, move-event, or case-reorder behavior was changed or exercised in this writer task.
- Independent read-only verification: pass; the responsive pane contract, folder API/CRUD/move behavior, and scope were preserved.
- `docker compose build`: completed successfully; the bounded build reached image export before the client timeout, and the resulting image was confirmed and started.
- `docker compose up -d`: completed; `unittcms` and `redis` are healthy.
- `GET http://localhost:8000/api/health/`: HTTP 200 with `{"status":"ok"}`.

## Next step

Work unit complete. Authenticated QA/browser confirmation remains pending; refresh the folder cases page to verify the tree rows are visible.
