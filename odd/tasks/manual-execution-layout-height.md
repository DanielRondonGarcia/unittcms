# Manual execution layout height

## Objective

Keep the project workspace and its run/manual-execution panes stretched to the available viewport height without leaving an unintended blank region below the content.

## Problem

The project layout owns a `calc(100vh - 64px)` height while the root `main` and intermediate project wrappers do not participate in the flex height chain. Descendant `h-full` sizing in `ResizablePanes` can therefore resolve against an indefinite parent when the manual execution panel changes its content.

## Why

Opening a manual execution exposes the sizing defect: the pane content becomes taller, the visible workspace can stop before the viewport, and the remaining area shows the page background.

## Scope

- Make the root application shell assign the remaining height after the header to `main`.
- Replace the nested project viewport calculation with a full-height flex chain.
- Preserve the existing sidebar, run split, tab scrolling, responsive behavior, and manual execution content.
- Add or update only focused layout regression coverage if needed.

## Constraints

- Do not modify manual-execution API/state behavior.
- Do not add `min-h-full` to the manual card as a visual workaround.
- Do not touch unrelated worktree files.
- Technical artifacts and code comments remain in English.

## Authorized scope

- `frontend/src/app/[locale]/layout.tsx`
- `frontend/src/app/[locale]/projects/[projectId]/layout.tsx`
- Focused tests for the affected layout, if required.

## Tasks

- [x] LAYOUT-001 Make the root `main` the `flex-1 min-h-0` content region and keep the app shell full-height.
- [x] LAYOUT-002 Propagate `h-full min-h-0` through the project layout wrappers and remove the duplicate viewport-height calculation.
- [x] LAYOUT-003 Run focused layout tests and inspect the final diff for unrelated changes.

## Acceptance criteria

- The root header plus `main` occupy the viewport without relying on a hard-coded header subtraction in the nested project layout.
- The project shell, its content wrapper, `ResizablePanes`, and both panes receive a definite full height.
- Switching to `?tab=manualExecution` does not make the workspace visibly shorter or create an unintended blank region below it.
- Existing focused tests pass and no unrelated files are changed.

## Checks

- `npx vitest run "frontend/src/app/[locale]/projects/[projectId]/runs/[runId]/cases/[caseId]/DetailPane.test.tsx" "frontend/src/app/[locale]/projects/[projectId]/runs/[runId]/layout.test.tsx"`
- `git diff --check`
- `git status --short`

## Progress

- Investigation completed from the user screenshots and local source.
- LAYOUT-001 completed: the root body now uses a full-screen baseline and `main` owns the remaining flex height with `flex-1 min-h-0 flex flex-col`.
- LAYOUT-002 completed: the project shell and both intermediate content wrappers now propagate `h-full` while preserving existing overflow, sidebar, width, and `min-h-0` behavior.
- Focused implementation verification completed; the independent verifier found no blocking findings.
- Parent spot check completed: focused tests passed, the diff check passed, and only the two authorized source files plus this task document are changed.
- Local Docker validation completed: the rebuilt `unittcms` and `redis` services are healthy and `GET http://localhost:8000/api/health/` returned HTTP 200 with `{"status":"ok"}`.
- The unauthenticated manual-execution URL redirected to `/es/account/signin`; the sign-in page rendered with `main` occupying the available post-header height. Authenticated manual-tab interaction remains pending.

## Verification evidence

- Baseline focused tests: 2 files, 7 tests passed before implementation.
- `npx vitest run "frontend/src/app/[locale]/projects/[projectId]/runs/[runId]/cases/[caseId]/DetailPane.test.tsx" "frontend/src/app/[locale]/projects/[projectId]/runs/[runId]/layout.test.tsx"`: 2 files passed, 7 tests passed.
- `git diff --check`: passed with exit code 0; Git emitted only LF-to-CRLF working-copy normalization warnings for the two modified source files.
- Independent read-only verification: pass; no blocking findings; `ResizablePane.tsx` unchanged.
- Parent spot check repeated the focused tests: 2 files passed, 7 tests passed; `git status --short --untracked-files=all` showed only the authorized files.
- `docker compose build`: completed successfully after the initial bounded build attempt timed out during image export.
- `docker compose up -d`: `unittcms` and `redis` started successfully; both reported healthy.
- `GET http://localhost:8000/api/health/`: HTTP 200, body `{"status":"ok"}`.
- Browser route check: unauthenticated request redirected to `/es/account/signin`; two expected 401 console errors were observed for the unauthenticated member check.

## Next step

Work unit complete. Local stack remains running at `http://localhost:8000`; authenticated manual-tab viewport acceptance remains pending because no local credentials were supplied.
