# Case reorder UI

## Objective

Make folder-scoped case ordering discoverable and operable from the cases UI while preserving the existing complete-permutation API, server reconciliation, rollback, and read-only run-selector ordering.

## Problem

The folder case table already persists drag/drop reorders through `PUT /cases/reorder`, but the interaction has no visible handle or guidance, is silently unavailable for filtered/alternate-sort views, and has no keyboard or tap-friendly alternative. The run selector correctly reflects folder order and must remain read-only.

## Why

Users cannot reliably discover that a case row is draggable or understand why reordering is unavailable. A folder-scoped position also needs an accessible interaction that does not depend on drag gestures.

## Scope

- Add localized, visible reorder guidance and a clear drag affordance to the folder cases table.
- Add accessible row actions for moving a case up/down using the existing complete-order callback.
- Explain blocked states caused by filters, alternate sorting, or insufficient permission without changing persistence rules.
- Preserve multi-selection drag/drop, server-confirmed reconciliation, rollback, immutable IDs, and run-selector read-only behavior.
- Add focused component/type coverage and update all supported locale catalogs.

## Constraints

- Position remains one-based and folder-scoped; never renumber case IDs.
- Reuse the existing `onReorderCases`/`reorderCases` path; do not duplicate API or ordering algorithms.
- Do not enable reordering from the run selector.
- Do not change backend, MCP, `CasesPane` persistence semantics, or unrelated worktree files.
- Technical artifacts and code comments remain in English; user-facing copy is localized.

## Authorized scope

- `frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.tsx`
- `frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.test.tsx`
- `frontend/utils/caseOrdering.ts`
- `frontend/utils/caseOrdering.test.ts`
- `frontend/types/case.ts`
- The folder cases page message mapping and all supported locale catalogs.
- `odd/tasks/case-reorder-ui.md` and its Engram mirror.

## Tasks

- [x] UI-001 Add the visible drag affordance, localized guidance, and explicit blocked-state messaging without weakening existing guards.
- [x] UI-002 Add accessible move-up/move-down actions that submit complete permutations through the existing callback and preserve loading/disabled behavior.
- [x] UI-003 Add focused tests and locale keys, run type/lint/format/test checks, and reconcile the final task state.
- [x] UI-004 Accept sparse legacy positions in the canonical folder view while continuing to reject missing, duplicate, or invalid positions.

## Acceptance criteria

- A user viewing an unfiltered, position-ordered folder can see that cases can be reordered.
- A user can move a case up or down without using drag/drop; first/last rows disable the unavailable direction.
- Filtered, alternate-sorted, unauthorized, and saving states remain safe and explainable.
- Existing multi-row drag/drop and server rollback behavior remain unchanged.
- The run selector continues to display folder order without writing positions.
- Focused tests and changed-file checks pass; no unrelated files change.

## Checks

- `npx vitest run "frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.test.tsx" "frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/CasesPane.test.tsx" --maxWorkers=1 --minWorkers=1`
- `npx tsc --noEmit -p frontend/tsconfig.json`
- `npx eslint <changed-files>`
- `npx prettier --check <changed-files>`
- `git diff --check`
- `git status --short`

## Progress

- Existing folder drag/drop and API persistence were verified before this task.
- Product scope confirmed: folder cases view is the primary reorder surface; run selector remains read-only.
- UI-001 and UI-002 are implemented. The table now exposes a localized drag handle/guidance, explains filtered/alternate-sorted/unauthorized/saving states, and provides guarded move-up/move-down actions that submit complete permutations through the existing helper and callback.
- UI-003 writer checks are complete; the parent spot check and independent verification also passed.
- The first local screenshot was served by the image built before this UI work; the image was rebuilt and the service recreated with the current UI before UI-004.
- Local reproduction found folder 1 positions `1` and `18`; the canonical ordering guard rejected this sparse legacy state before calling the API, so arrow and drag actions were no-ops. UI-004 is the targeted correction.
- UI-004 is complete: `canonicalRows()` still requires every row to have a unique valid ID and a unique positive position, but now accepts sparse legacy positions. Their sorted sequence is used as the canonical order, and the existing complete permutation API can normalize positions after a successful write.

## Changed files

- `frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.tsx` — drag affordance, localized reorder notices, guarded row actions, and shared submit path.
- `frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.test.tsx` — affordance, complete-permutation action, blocked-state, saving-state, and boundary coverage.
- `frontend/utils/caseOrdering.ts` — canonical sparse-position acceptance with complete-row safety guards.
- `frontend/utils/caseOrdering.test.ts` — sparse, missing, duplicate-position, and invalid/non-positive-position reorder guard coverage.
- `frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/page.tsx` — folder cases message mapping.
- `frontend/types/case.ts` — reorder message contract.
- `frontend/messages/de.json`, `frontend/messages/en.json`, `frontend/messages/es.json`, `frontend/messages/ja.json`, `frontend/messages/pt-BR.json`, `frontend/messages/zh-CN.json` — localized reorder messages.
- `frontend/messages/strings.test.ts` — updated the locale key-count contract for the eight new `Cases` keys.
- `odd/tasks/case-reorder-ui.md` — progress and verification evidence.

## Verification evidence

- Existing ORDER-009 focused UI tests passed in the prior case-ordering work; this task adds discoverability and accessible actions.
- `npx vitest run "frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.test.tsx" "frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/CasesPane.test.tsx" --maxWorkers=1 --minWorkers=1`: PASS — 2 test files and 8 tests passed.
- `npx vitest run "frontend/messages/strings.test.ts" --maxWorkers=1 --minWorkers=1`: PASS — 1 test file and 12 tests passed.
- `npx tsc --noEmit -p frontend/tsconfig.json`: PASS — no output.
- `npx eslint "frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.tsx" "frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.test.tsx" "frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/page.tsx" "frontend/types/case.ts" "frontend/messages/strings.test.ts"`: PASS — no output.
- `npx prettier --check "frontend/messages/de.json" "frontend/messages/en.json" "frontend/messages/es.json" "frontend/messages/ja.json" "frontend/messages/pt-BR.json" "frontend/messages/zh-CN.json" "frontend/messages/strings.test.ts" "frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.test.tsx" "frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.tsx" "frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/page.tsx" "frontend/types/case.ts"`: PASS — all matched files use Prettier code style.
- `git diff --check`: PASS — no whitespace errors; Git reported only the existing LF/CRLF normalization warning for the modified test file.
- Independent read-only verification: PASS — no blocking findings; the run selector and persistence path remain unchanged.
- Parent spot check: the focused component/CasesPane test command passed with 2 files and 8 tests; `git diff --check` passed and status contains the 13 modified tracked paths plus this untracked task document.
- Historical pre-UI-004 local validation after rebuilding: `docker compose build` completed, `docker compose up -d` recreated `unittcms`, both `unittcms` and `redis` were healthy, and `GET http://localhost:8000/api/health/` returned HTTP 200 with `{"status":"ok"}`.
- `npx vitest run "frontend/utils/caseOrdering.test.ts" "frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.test.tsx" --maxWorkers=1 --minWorkers=1`: PASS — 2 test files and 18 tests passed, including sparse-position permutation, missing-position, duplicate-position, and invalid/non-positive-position rejection coverage.
- `npx tsc --noEmit -p frontend/tsconfig.json`: PASS — no output.
- `npx eslint "frontend/utils/caseOrdering.ts" "frontend/utils/caseOrdering.test.ts"`: PASS — no output.
- `npx prettier --check "frontend/utils/caseOrdering.ts" "frontend/utils/caseOrdering.test.ts"`: PASS — all matched files use Prettier code style.
- `git diff --check`: PASS — no whitespace errors; Git reported only LF/CRLF normalization warnings for modified files.
- Post-UI-004 local validation: `docker compose build` completed, `docker compose up -d` recreated `unittcms`, both services are healthy, and `GET http://localhost:8000/api/health/` returned HTTP 200 with `{"status":"ok"}`.

## Next step

UI-004 is complete. The bounded checks pass and the local image has been rebuilt after UI-004. Authenticated browser validation of moving case 1/case 18 remains for the user; the run selector remains read-only by design.
