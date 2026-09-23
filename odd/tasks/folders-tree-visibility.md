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
- Keep the existing project routing, pane structure, folder data contract, drag/drop move events, and folder CRUD behavior unchanged; only extend the project workspace wrapper's flex participation when required to propagate available height.
- Add focused pure coverage if the sizing fallback is extracted; otherwise run changed-file checks and local container validation.

## Constraints

- Do not change folder persistence or API contracts.
- Do not hide real fetch failures; preserve existing logging and surface only a safe UI state if implemented.
- Do not touch the case reorder UI or unrelated files.
- Technical artifacts and code comments remain in English.

## Authorized scope

- `frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx`
- `frontend/src/app/[locale]/projects/[projectId]/layout.tsx` (only the workspace wrapper height propagation)
- Focused folder-tree tests if needed.
- `odd/tasks/folders-tree-visibility.md` and its Engram mirror.

## Tasks

- [x] TREE-001 Make tree sizing resilient to zero/initial measurements.
- [x] TREE-002 Run focused frontend checks, rebuild local Docker, and record the result.
- [x] TREE-003 Re-measure after the flex layout settles so the tree uses the full available pane height.
- [x] TREE-004 Make the project workspace wrapper participate in the main flex height so the folder pane receives the full available height.

## Acceptance criteria

- Existing folder rows render when the tree container is temporarily measured at zero.
- A later positive `ResizeObserver` measurement updates the tree dimensions.
- The tree is not intentionally rendered at `1px` as a fallback.
- Cases, folder CRUD, move events, and project routing/pane structure remain unchanged.
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
- QA follow-up shows the outer container at about 712px while the Tree still has inline height 192px; TREE-003 is the targeted correction so the fallback cannot remain a visible cap.
- TREE-003 implemented in `frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx`: measurement now uses `ResizeObserverEntry.contentRect` with `getBoundingClientRect` fallback, runs in `useLayoutEffect`, remeasures on the next animation frame and after a bounded 100ms timer, and cleans up all observer/frame/timer resources.
- Parent local validation completed after TREE-003: the image was rebuilt, `unittcms` was recreated, and the health endpoint returned HTTP 200.
- Local authenticated browser inspection at 1920x889 found `main` at 825px high but the project workspace wrapper at only 338px, with the folder tree still at the 192px fallback. The wrapper was not a flex-growing child of `main`; TREE-004 targets that parent-chain defect.
- Browser DOM probing confirmed that adding `flex-1` to the project workspace root alone was insufficient: the nested row wrapper's `h-full` percentage height resolved to its 240px intrinsic content height. Removing that `h-full` lets the default flex cross-axis stretch provide 824px, after which the folder pane and tree expand to 776px.

## Verification evidence

- Changed files: `frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx`, `frontend/src/app/[locale]/projects/[projectId]/layout.tsx`
- `npx tsc --noEmit -p frontend/tsconfig.json`: passed, exit code 0, no output.
- `npx eslint "frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx"`: passed, exit code 0, no output.
- `npx prettier --check "frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx"`: passed, output `All matched files use Prettier code style!`.
- `git diff --check`: passed, exit code 0; Git emitted the line-ending warning that LF will be replaced by CRLF the next time it touches the file.
- The TREE-001/TREE-003 writer task did not change or exercise Docker, browser, backend, MCP, API, CRUD, move-event, or case-reorder behavior.
- Independent read-only verification: pass; the responsive pane contract, folder API/CRUD/move behavior, and scope were preserved.
- `docker compose build`: completed successfully; the bounded build reached image export before the client timeout, and the resulting image was confirmed and started.
- `docker compose up -d`: completed; `unittcms` and `redis` are healthy.
- `GET http://localhost:8000/api/health/`: HTTP 200 with `{"status":"ok"}`.
- QA evidence addressed: the prior approximately 712px container height is now eligible to replace the 192px fallback after layout settlement; zero/near-zero geometry remains ignored.
- TREE-003 checks: `npx tsc --noEmit -p frontend/tsconfig.json`: passed, exit code 0, no output.
- TREE-003 checks: `npx eslint "frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx"`: passed, exit code 0, no output.
- TREE-003 checks: `npx prettier --check "frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx"`: passed, output `All matched files use Prettier code style!`.
- TREE-003 checks: `git diff --check`: passed, exit code 0; Git emitted the LF-to-CRLF normalization warning for the changed files.
- TREE-003 local runtime: `docker compose build` completed, `docker compose up -d` recreated `unittcms`, both `unittcms` and Redis are healthy, and `GET http://localhost:8000/api/health/` returned HTTP 200 with `{"status":"ok"}`.
- TREE-004 checks: `npx tsc --noEmit -p frontend/tsconfig.json` passed with exit code 0 and no output.
- TREE-004 checks: `npx eslint "frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx" "frontend/src/app/[locale]/projects/[projectId]/layout.tsx"` passed with exit code 0 and no output.
- TREE-004 checks: `npx prettier --check "frontend/src/app/[locale]/projects/[projectId]/folders/FoldersPane.tsx" "frontend/src/app/[locale]/projects/[projectId]/layout.tsx" "odd/tasks/folders-tree-visibility.md"` passed; all matched files use Prettier code style.
- TREE-004 checks: `git diff --check` passed; Git reported only the existing LF-to-CRLF normalization warning.
- TREE-004 local runtime: `docker compose build` completed successfully, `docker compose up -d` recreated `unittcms`, and `GET http://localhost:8000/api/health/` returned `{"status":"ok"}`.
- TREE-004 browser verification: authenticated local page at 1920x889 measured `main` at 825px, the project workspace at 825px, the nested workspace wrapper at 824px, the resizable pane at 824px, and `[role="tree"]` at 776px instead of the previous 338px/240px/192px chain.

## Next step

TREE-004 is complete locally. QA confirmation after deploying this uncommitted fix remains pending; do not generate a new release until the user requests it.
