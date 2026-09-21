# Case order reordering

## Objective

Make test-case order explicit, stable, and easy for both users and AI agents to control. A case such as database ID `10` must be movable to the third position without changing its immutable ID or breaking references.

## Problem

UnitTCMS currently uses creation IDs as the apparent order in the folder table, run selector, and MCP listing. The ID is an identity, not a safe ordering field, so users and AI clients cannot express or persist a reliable instruction such as “move case 10 to position 3.”

## Why

An explicit folder-scoped order removes the accidental coupling between identity and presentation, keeps existing references stable, and gives the UI, REST API, and MCP one deterministic contract.

## Authorized scope

- `backend/migrations/20260920200000-add-position-to-cases.js`
- `backend/migrations-tests/case-position.test.ts`
- `backend/models/cases.js`
- `backend/routes/cases/orderService.js`
- `backend/routes/cases/orderService.test.js`
- `backend/routes/cases/index.js`
- `backend/routes/cases/indexByProjectId.js`
- `backend/routes/cases/index.test.js`
- `backend/routes/cases/indexByProjectId.test.js`
- `backend/routes/cases/new.js`
- `backend/routes/cases/edit.js`
- `backend/routes/cases/move.js`
- `backend/routes/cases/orderRoutes.test.js`
- `backend/routes/cases/clone.js`
- `backend/routes/cases/clone.test.js`
- `backend/routes/folders/clone.js`
- `backend/routes/folders/clone.test.js`
- `backend/routes/cases/import.js`
- `backend/routes/cases/import.test.js`
- `backend/routes/cases/gherkin.test.js`
- `backend/routes/cases/reorder.js`
- `backend/routes/cases/reorder.test.js`
- `backend/server.ts`
- `backend/mcp/operations.ts`
- `backend/mcp/operations.test.ts`
- `frontend/types/case.ts`
- `frontend/utils/caseControl.ts`
- `frontend/utils/caseControl.test.ts`
- `frontend/utils/caseOrdering.ts`
- `frontend/utils/caseOrdering.test.ts`
- `frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.tsx`
- `frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.test.tsx`
- `frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/CasesPane.tsx`
- `frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/CasesPane.test.tsx`
- `frontend/src/app/[locale]/projects/[projectId]/runs/[runId]/TestCaseSelector.tsx`
- `frontend/src/app/[locale]/projects/[projectId]/runs/[runId]/TestCaseSelector.test.tsx`
- `odd/tasks/case-order-reordering.md`
- This feature's Engram mirror under `odd/case-order-reordering/tasks`

## Constraints

- Preserve `Case.id` as immutable primary identity; never renumber IDs to reorder cases.
- Store a positive, contiguous, folder-scoped `position`; public positions are one-based.
- A complete reorder request must validate every case in the folder exactly once and apply atomically.
- Moving cases between folders appends them in request order and resequences the source folder.
- Creation without a position appends; explicit creation/update positions shift neighboring cases safely.
- Use the same ordering behavior for REST and MCP; do not duplicate ordering algorithms.
- The folder selector inherits folder order, but independent persisted `runCases` ordering is out of scope.
- Drag and drop must be disabled or rejected for filtered/alternate-sort views that cannot provide a complete folder permutation.
- Use Standard Mode. The resolved project context has `strict_tdd: false`; runner: `npm test -- --run`.
- Do not modify existing SDD artifacts, commit, push, create a PR, or perform remote/deployment work.
- Re-check `git status --short` and preserve any unrelated work before every writer task.

## Checklist

- [x] ORDER-001: Add the `position` migration, backfill legacy rows from `id`, add the model field, and cover the schema/backfill contract.
- [x] ORDER-002: Implement the transactional shared ordering service and focused unit tests for normalization, append, insert, position update, complete permutation validation, move append, and rollback.
- [x] ORDER-003: Make folder and project case-list routes deterministic with `position ASC, id ASC`, including focused route coverage.
- [x] ORDER-004: Apply append/insert/update/move semantics to REST create, edit, and move paths without changing IDs.
- [x] ORDER-005: Add the authenticated complete-permutation `PUT /cases/reorder` route, register it before `/:caseId`, and test success, authorization, validation, and rollback.
- [x] ORDER-006: Preserve canonical order through case clone, folder clone, and spreadsheet import paths, with regression assertions.
- [x] ORDER-007: Expose position and a complete reorder operation through MCP while reusing the shared ordering service and safe error conventions.
- [x] ORDER-008: Add frontend position typing, authenticated reorder helper, pure drag permutation helper, and focused helper tests.
- [x] ORDER-009: Wire guarded drag/drop into the folder table and pane, refresh from the server, and make the run selector inherit folder order without adding run-level persistence.
- [x] ORDER-010: Run integrated regression, build, formatting, and manual acceptance checks; reconcile remaining work honestly.

## Acceptance criteria

- Existing cases preserve their relative order after migration and retain their original IDs.
- Listing a folder or loading the case selector orders cases by persisted position, then ID as a deterministic tie-break.
- An AI/MCP client can submit a complete folder order and verify that case `10` has `position: 3`.
- Duplicate, missing, unknown, or foreign case IDs are rejected before any reorder mutation.
- Reorder, create, update, move, import, and clone failures leave affected folders and related records unchanged.
- The UI persists a valid drag/drop reorder and restores the last server-confirmed order after failure.
- Existing runs are not silently reordered when their source folder changes.
- Focused and full applicable tests pass, or every unavailable/pre-existing environment failure is recorded with bounded evidence.

## Applicable checks

1. Focused Vitest command for the current task, for example `npm test -- --run backend/routes/cases/orderService.test.js`.
2. Relevant backend/frontend focused tests after each integration task.
3. `npm test -- --run` for backend/regression coverage when the backend slice is complete.
4. `npx vitest run` for frontend/regression coverage when the frontend slice is complete.
5. `npm run build` after frontend/backend contracts are wired.
6. `npm run lint` and `npm run format:check` over changed files or the repository, recording any baseline failures separately.
7. `git diff --check` and `git status --short` before delivery.
8. Manual UI acceptance: reorder case 10 to position 3, reload, confirm order persists and ID remains 10.

## Progress

- ORDER-007 is complete: MCP case projections expose one-based folder-scoped `position`; list ordering is deterministic by `folderId ASC, position ASC, id ASC`; create, update, move, and complete reorder operations delegate ordering writes to the shared service while preserving safe authorization and error envelopes.
- Task document created before source changes.
- Current worktree was clean before this task document was created.
- ORDER-001 implementation is complete; later ordering behavior remains intentionally untouched.
- The migration preserves immutable IDs, backfills `position = id`, makes `position` non-null, and adds the unique `(folderId, position)` index.
- `Case.position` is exposed as a required integer without a default scope.
- ORDER-002 is complete: the shared service reads deterministic folder order, validates complete permutations before writes, uses collision-free temporary positions, and runs mutating operations in a managed or supplied Sequelize transaction.
- ORDER-003 is complete: the folder list orders by `position ASC, id ASC`; the project/run-selector list orders by `folderId ASC, position ASC, id ASC` without adding run-case persistence.
- ORDER-004 is complete: REST create, edit, and move paths delegate all ordering mutations to the shared service, keep related create/edit writes transactional, ignore immutable identity/folder fields on edit, and preserve the move response contract.
- ORDER-005 is complete: the authenticated folder-scoped reorder route delegates complete-permutation validation and transactional writes to the shared service, maps safe ordering errors, and is registered before parameterized case routes.
- ORDER-006 is complete: case clone, recursive folder clone, and spreadsheet import paths now use canonical `position ASC, id ASC` reads and shared transactional ordering semantics; imported cases receive consecutive append positions without counting step rows.
- ORDER-008 is complete: frontend case projections normalize optional one-based positions, create/update payloads preserve position without sending identity fields, the authenticated reorder helper uses the complete `PUT /cases/reorder` contract, and pure ordering helpers guard against incomplete, filtered, or alternate-sort views.
- ORDER-009 is complete: the folder table now defaults to position order with deterministic ID fallback, submits complete guarded drag/drop permutations including existing multi-selection, and exposes saving/rollback state; the pane calls the authenticated reorder helper, reconciles successful responses with a server refresh, and restores the last confirmed list on failure; the run selector inherits `folderId`, `position`, `id` ordering without mutating `RunCases`.
- ORDER-010 automated verification is complete: full tests, TypeScript, backend build, frontend build, focused lint, focused formatting, and structural checks were recorded; manual/browser acceptance remains deferred.

## Verification evidence

- Focused: `npm test -- --run backend/migrations-tests/case-position.test.ts` — passed; 1 file and 2 tests passed.
- Parent spot check: `npm test -- --run backend/migrations-tests/case-position.test.ts` — passed; 1 file and 2 tests passed.
- Migration smoke: an in-memory SQLite run passed backfill, non-null schema, unique-index creation, and `down` cleanup.
- Structural: `git diff --check` — passed.
- State before ORDER-002 writes: `git status --short` showed only the ORDER-001 files and this task document as changed/untracked.
- Independent read-only verification passed for ORDER-001; ORDER-002 through ORDER-008 are now complete and ORDER-009 through ORDER-010 remain pending.

## ORDER-002 verification evidence

- Focused: `npm test -- --run backend/routes/cases/orderService.test.js` — passed; 1 file and 8 tests passed.
- Static: `npx eslint backend/routes/cases/orderService.js backend/routes/cases/orderService.test.js` — passed.
- Formatting: `npx prettier --check backend/routes/cases/orderService.js backend/routes/cases/orderService.test.js` — passed.
- Parent spot check: `npm test -- --run backend/routes/cases/orderService.test.js` — passed; 1 file and 8 tests passed.
- Coverage: tests prove normalization, append/create placement, explicit insert, same-folder move, supplied-transaction permutation moving case `10` to position `3`, duplicate/missing/unknown/foreign rejection before `Case.update`, cross-folder append in request order, and rollback after a simulated persistence failure.
- Exact ORDER-002 files: `backend/routes/cases/orderService.js`, `backend/routes/cases/orderService.test.js`, and this task document.
- Warning/limitation: the focused SQLite harness uses the actual Case and Folder model definitions and the real composite unique index, but disables unrelated SQLite foreign-key enforcement because the existing Folder model references the singular `project` table while this service test intentionally does not provision the project schema. Ordering reads, temporary writes, final writes, and transaction rollback remain exercised against SQLite.
- Warning/limitation: REST routes, MCP operations, clone/import integration, and full regression/build checks remain intentionally deferred to ORDER-003 through ORDER-010.
- Review policy: receipt-driven development is disabled/unmanaged; the native risk assessment classified the current untracked candidate as medium with 902 snapshot lines, so no review lifecycle was started. The service and its invariants were kept together as one coherent ODD work unit rather than artificially splitting the shared algorithm from its tests.

## ORDER-003 verification evidence

- Focused: `npm test -- --run backend/routes/cases/index.test.js backend/routes/cases/indexByProjectId.test.js` — passed; 2 files and 4 tests passed.
- Parent spot check: `npm test -- --run backend/routes/cases/index.test.js backend/routes/cases/indexByProjectId.test.js` — passed; 2 files and 4 tests passed.
- Static: `npx eslint backend/routes/cases/index.js backend/routes/cases/indexByProjectId.js backend/routes/cases/index.test.js backend/routes/cases/indexByProjectId.test.js` — passed with no output.
- Structural: `git diff --check` — passed; Git emitted only line-ending normalization warnings for modified tracked files (`LF will be replaced by CRLF`).
- State: `git status --short` — preserved the existing ORDER-001/ORDER-002 files and showed the four ORDER-003 route files plus this task document as the current unit changes.
- Coverage: the folder route assertion verifies the exact `position ASC, id ASC` Sequelize order; the project route assertion verifies the exact folder-scoped `folderId ASC, position ASC, id ASC` order while retaining the existing RunCase and tag includes in the route implementation.
- Limitation: verification is focused and mocked at the route query boundary; full regression, build, formatting, database-backed route execution, and manual UI acceptance remain deferred to ORDER-010 and the later integration tasks.
- Review policy: receipt-driven development is disabled/unmanaged; the native risk assessment classified the current untracked candidate as medium with 1,035 snapshot lines, so no review lifecycle was started.

## ORDER-004 verification evidence

- Focused: `npm test -- --run backend/routes/cases/orderRoutes.test.js backend/routes/cases/gherkin.test.js` — passed; 2 files and 31 tests passed.
- Parent spot check: `npm test -- --run backend/routes/cases/orderRoutes.test.js backend/routes/cases/gherkin.test.js` — passed; 2 files and 31 tests passed.
- Preserved-order spot check: `npm test -- --run backend/routes/cases/orderService.test.js backend/routes/cases/index.test.js backend/routes/cases/indexByProjectId.test.js` — passed; 3 files and 12 tests passed.
- Static: `npx eslint backend/routes/cases/new.js backend/routes/cases/edit.js backend/routes/cases/move.js backend/routes/cases/orderRoutes.test.js` — passed with no output.
- Formatting: `npx prettier --check backend/routes/cases/new.js backend/routes/cases/edit.js backend/routes/cases/move.js backend/routes/cases/orderRoutes.test.js backend/routes/cases/gherkin.test.js` — passed after targeted normalization.
- Coverage: REST tests verify create append/insert delegation, edit position movement, identity-safe metadata edits, request-order move delegation and response compatibility, ordering validation mapping, authentication, project authorization, and immutable IDs. The existing service suite continues to prove neighbor shifting and source-folder resequencing against SQLite.
- Transaction contract: create now composes the shared service and Gherkin step persistence in one transaction; edit composes metadata, step, and position writes in one transaction when ordering is requested; move uses the service-managed transaction.
- Limitation: route tests mock the shared service at the HTTP boundary; full database-backed REST execution, full regression/build/format checks, manual UI acceptance, clone/import integration, MCP, frontend, and complete reorder endpoint work remain deferred to ORDER-005 through ORDER-010.
- State: prior ORDER-001 through ORDER-003 files were preserved; no SDD, remote, Docker, or delivery operations were performed.
- Review policy: receipt-driven development remains disabled/unmanaged; the native risk assessment classified the current untracked candidate as medium with 1,447 snapshot lines, so no native review lifecycle was started.

## ORDER-005 verification evidence

- Focused: `npm test -- --run backend/routes/cases/reorder.test.js` — passed; 1 file and 10 tests passed.
- Parent spot check: `npm test -- --run backend/routes/cases/reorder.test.js backend/routes/cases/orderService.test.js` — passed; 2 files and 18 tests passed.
- Shared service regression: `npm test -- --run backend/routes/cases/orderService.test.js` — passed; 1 file and 8 tests passed, including database-backed complete-permutation validation and persistence rollback.
- Static: `npx eslint backend/routes/cases/reorder.js backend/routes/cases/reorder.test.js backend/server.ts` — passed with no output after correcting the test import order.
- Structural: `git diff --check` — passed; Git emitted only existing line-ending normalization warnings for modified files.
- Coverage: the route harness verifies `PUT /cases/reorder` registration before the parameterized case route, authenticated/project-editable access, missing-folder rejection, complete permutation response with case `10` at `position: 3`, immutable IDs, duplicate/missing/unknown/foreign validation mapping, and safe handling of simulated persistence failures.
- Transaction contract: the route delegates to the service-managed transaction and performs no direct ordering writes. The route harness models persistence failure as a service rejection; the shared SQLite service suite remains the database-backed proof that temporary and final writes roll back atomically.
- Limitation: route tests use mocked auth, project-editable middleware, and ordering service at the HTTP boundary; full regression/build/format checks, live database-backed REST execution, manual UI acceptance, clone/import integration, MCP, frontend, and ORDER-006 through ORDER-010 remain deferred.
- State: prior ORDER-001 through ORDER-004 files were preserved; no SDD, remote, Docker, or delivery operations were performed. Receipt-driven development is disabled/unmanaged.
- Review policy: the native risk assessment classified the current untracked candidate as medium with 1,671 snapshot lines; receipt-driven development remains disabled/unmanaged and no native review lifecycle was started.

## ORDER-006 verification evidence

- Focused: `npm test -- --run backend/routes/cases/clone.test.js backend/routes/folders/clone.test.js backend/routes/cases/import.test.js backend/routes/cases/gherkin.test.js` — passed; 4 files and 42 tests passed.
- Parent spot check: the same focused command was rerun after formatting — passed; 4 files and 42 tests passed.
- Static: `npx eslint backend/routes/cases/clone.js backend/routes/folders/clone.js backend/routes/cases/import.js backend/routes/cases/clone.test.js backend/routes/folders/clone.test.js` — passed with no output.
- Formatting: `npx prettier --check backend/routes/cases/clone.js backend/routes/folders/clone.js backend/routes/cases/import.js backend/routes/cases/clone.test.js backend/routes/folders/clone.test.js backend/routes/cases/import.test.js backend/routes/cases/gherkin.test.js` — passed.
- Regression spot check: `npm test -- --run backend/routes/cases/orderService.test.js backend/routes/cases/orderRoutes.test.js` — passed; 2 files and 14 tests passed.
- Structural: `git diff --check` — passed; Git emitted only existing LF/CRLF normalization warnings for modified tracked files.
- Coverage: case clone reads source cases in canonical order, strips source IDs and positions, appends fresh IDs through `createCase`; folder clone applies the same contract recursively; import normalizes the target folder transactionally before assigning consecutive positions only to distinct cases; Gherkin step keywords, sections, and step order remain covered.
- Transaction contract: clone writes and related step/join writes remain inside the existing route transaction; import normalization, bulk case creation, and step/join writes remain in the same manually managed transaction; the shared service tests continue to prove collision-free writes and rollback behavior.
- Limitation: clone/folder/import route tests mock Sequelize models and the HTTP middleware, so a live database-backed clone/import run, full regression, build, repository-wide lint/format, and manual UI acceptance remain deferred to ORDER-010 and later integration work. Existing unrelated ORDER-001 through ORDER-005 worktree changes were preserved.
- Review policy: receipt-driven development remains disabled/unmanaged; the native risk assessment classified the current untracked candidate as medium with 2,241 snapshot lines, so no native review lifecycle was started.

## ORDER-007 verification evidence

- Focused: `npm test -- --run backend/mcp/operations.test.ts` — passed; 1 file and 19 tests passed.
- Parent spot check: `npm test -- --run backend/mcp/operations.test.ts` — passed; 1 file and 19 tests passed.
- Static: `npx eslint backend/mcp/operations.ts backend/mcp/operations.test.ts` — passed with no output.
- Formatting: `npx prettier --check backend/mcp/operations.ts backend/mcp/operations.test.ts` — passed; all matched files use Prettier code style.
- Structural: `git diff --check` — passed; Git emitted only existing LF/CRLF normalization warnings for modified tracked files.
- Coverage: MCP tests verify safe position exposure in metadata/full projections, folder-first position ordering, create append/insert, update movement with immutable IDs, move append order, reorder registration, complete-permutation duplicate/missing/unknown/foreign validation before `Case.update`, success with case `10` at position `3`, authorization, and safe persistence-error mapping.
- Shared-service contract: MCP create, update, move, and reorder handlers call `createCaseOrderService`; TypeScript does not duplicate neighbor shifting or permutation algorithms.
- MCP harness limitation: the focused suite uses a fake registered-tool server and mocked Sequelize models, so it does not exercise a live authenticated MCP HTTP request or a database-backed MCP transaction. The shared SQLite service and REST suites remain the database-backed ordering evidence from ORDER-002 through ORDER-006.
- State: existing ORDER-001 through ORDER-006 worktree changes were preserved; no frontend, `runCases`, SDD, remote, Docker, or delivery operations were performed.
- Review policy: receipt-driven development remains disabled/unmanaged; the native risk assessment classified the current untracked candidate as medium with 2,676 snapshot lines, so no native review lifecycle was started.

## ORDER-007 files

- `backend/mcp/operations.ts`
- `backend/mcp/operations.test.ts`
- `odd/tasks/case-order-reordering.md`
- Engram mirror: `odd/case-order-reordering/tasks`

## ORDER-006 files

- `backend/routes/cases/clone.js`
- `backend/routes/cases/clone.test.js`
- `backend/routes/folders/clone.js`
- `backend/routes/folders/clone.test.js`
- `backend/routes/cases/import.js`
- `backend/routes/cases/import.test.js`
- `backend/routes/cases/gherkin.test.js`
- `odd/tasks/case-order-reordering.md`
- Engram mirror: `odd/case-order-reordering/tasks`

## ORDER-005 files

- `backend/routes/cases/reorder.js`
- `backend/routes/cases/reorder.test.js`
- `backend/server.ts`
- `odd/tasks/case-order-reordering.md`
- Engram mirror: `odd/case-order-reordering/tasks`

## ORDER-001 files

- `backend/migrations/20260920200000-add-position-to-cases.js`
- `backend/migrations-tests/case-position.test.ts`
- `backend/models/cases.js`
- `odd/tasks/case-order-reordering.md`
- Engram mirror: `odd/case-order-reordering/tasks`

## ORDER-002 files

- `backend/routes/cases/orderService.js`
- `backend/routes/cases/orderService.test.js`
- `odd/tasks/case-order-reordering.md`
- Engram mirror: `odd/case-order-reordering/tasks`

## ORDER-003 files

- `backend/routes/cases/index.js`
- `backend/routes/cases/indexByProjectId.js`
- `backend/routes/cases/index.test.js`
- `backend/routes/cases/indexByProjectId.test.js`
- `odd/tasks/case-order-reordering.md`
- Engram mirror: `odd/case-order-reordering/tasks`

## ORDER-004 files

- `backend/routes/cases/new.js`
- `backend/routes/cases/edit.js`
- `backend/routes/cases/move.js`
- `backend/routes/cases/orderRoutes.test.js`
- `backend/routes/cases/gherkin.test.js`
- `odd/tasks/case-order-reordering.md`
- Engram mirror: `odd/case-order-reordering/tasks`

## ORDER-008 verification evidence

- Focused: `npx vitest run frontend/utils/caseOrdering.test.ts frontend/utils/caseControl.test.ts` — passed; 2 files and 23 tests passed.
- Parent spot check: `npx vitest run frontend/utils/caseOrdering.test.ts frontend/utils/caseControl.test.ts` — passed; 2 files and 23 tests passed.
- Type check: `npx tsc --noEmit -p frontend/tsconfig.json` — passed with no output.
- Static: `npx eslint frontend/types/case.ts frontend/utils/caseControl.ts frontend/utils/caseOrdering.ts frontend/utils/caseControl.test.ts frontend/utils/caseOrdering.test.ts` — passed with no output.
- Formatting: `npx prettier --check frontend/types/case.ts frontend/utils/caseControl.ts frontend/utils/caseOrdering.ts frontend/utils/caseControl.test.ts frontend/utils/caseOrdering.test.ts` — passed; all matched files use Prettier code style.
- Structural: `git diff --check` — passed; Git emitted only existing LF/CRLF normalization warnings for modified tracked files.
- Coverage: request tests prove the authenticated `PUT /api/cases/reorder` URL, JSON body, response normalization, structured API errors, malformed/invalid input handling, and identity-safe create/update bodies. Pure helper tests prove position-first sorting with ID tie-breaks, moving case `10` to position `3`, deterministic multi-selection, filtered/alternate-sort refusal, incomplete-order refusal, and invalid/no-op inputs.
- Limitation: no component or browser work was performed; `TestCaseTable.tsx`, `CasesPane.tsx`, and `TestCaseSelector.tsx` remain unchanged for ORDER-009. The helper only permits a drag when the caller identifies an unfiltered, position-ascending view with a complete contiguous folder permutation; server-side completeness and persistence remain covered by ORDER-005 and deferred UI wiring.
- State: existing ORDER-001 through ORDER-007 backend worktree changes were preserved; this unit added only the five frontend helper/type/test files plus this task document. No SDD, `openspec/`, remote, Docker, environment, or delivery operations were performed.
- Review policy: receipt-driven development remains disabled/unmanaged; the native risk assessment classified the current untracked candidate as medium with 3,204 snapshot lines, so no native review lifecycle was started.

## ORDER-009 verification evidence

- Focused: `npx vitest run frontend/utils/caseOrdering.test.ts frontend/utils/caseControl.test.ts frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.test.tsx frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/CasesPane.test.tsx frontend/src/app/[locale]/projects/[projectId]/runs/[runId]/TestCaseSelector.test.tsx --maxWorkers=1 --minWorkers=1` — passed; 5 files and 31 tests passed.
- Parent spot check: the same bounded single-worker command was rerun — passed; 5 files and 31 tests passed.
- Type check: `npx tsc --noEmit -p frontend/tsconfig.json` — passed with no output.
- Static: `npx eslint frontend/utils/caseOrdering.ts frontend/utils/caseOrdering.test.ts frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.tsx frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.test.tsx frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/CasesPane.tsx frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/CasesPane.test.tsx frontend/src/app/[locale]/projects/[projectId]/runs/[runId]/TestCaseSelector.tsx frontend/src/app/[locale]/projects/[projectId]/runs/[runId]/TestCaseSelector.test.tsx` — passed with no output.
- Formatting: `npx prettier --check frontend/utils/caseOrdering.ts frontend/utils/caseOrdering.test.ts frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.tsx frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.test.tsx frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/CasesPane.tsx frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/CasesPane.test.tsx frontend/src/app/[locale]/projects/[projectId]/runs/[runId]/TestCaseSelector.tsx frontend/src/app/[locale]/projects/[projectId]/runs/[runId]/TestCaseSelector.test.tsx` — passed after targeted formatting.
- Structural: `git diff --check` — passed; Git emitted only existing LF/CRLF normalization warnings for prior tracked worktree files.
- Coverage: component tests verify complete multi-selection drag payloads, canonical position ordering, filtered/alternate-sort drag refusal, table rollback state, pane refresh/reconciliation and failure restoration, selector folder/position/id ordering, alternate title sorting, and unchanged run status/assignee rendering. The selector tests do not write or assert any `runCases.position` field.
- Limitation: browser/manual acceptance and full integrated regression/build remain deferred to ORDER-010; the bounded component Vitest command uses one worker because the default worker pool exceeded the environment memory limit during the first aggregate attempt. No browser or dev server was run.
- Execution note: the delegated worker exceeded its 20-minute planning budget during component-harness setup, but returned a complete result; all individual shell commands stayed within 120 seconds and the parent spot check passed.
- State: ORDER-001 through ORDER-008 files were preserved; this unit changed only the frontend ordering helper, three frontend components, their three focused component-test files, and this task document. No backend/MCP contracts, `runCases` persistence, SDD artifacts, remote, Docker, environment, or delivery operations were changed.
- Review policy: receipt-driven development remains disabled/unmanaged; the native risk assessment classified the current untracked candidate as medium with 4,164 snapshot lines, so no native review lifecycle was started.

## ORDER-010 verification evidence

- Full functional regression: `npm test -- --run` — passed; 113 test files passed, 1 skipped, 792 tests passed, 1 skipped. The skipped test is the unrelated real Hercules compatibility test.
- Frontend type check: `npx tsc --noEmit -p frontend/tsconfig.json` — passed.
- Backend build: `npm --prefix backend run build` — passed; tsoa, TypeScript, and Swagger asset copy completed; repository state was unchanged.
- Frontend build: `npm --prefix frontend run build` — passed; Next.js compiled, type validity passed, 3/3 static pages generated, and route optimization completed; repository state was unchanged.
- Focused changed-file lint: passed with no output. Repository-wide `npm run lint` remains a known baseline failure with 45 errors, none in the changed ORDER files.
- Focused changed-file formatting: passed after normalizing the exact eight reported files. Repository-wide `npm run format:check` still reports only the two unchanged baseline files `backend/public/swagger.json` and `backend/routes.ts`.
- Structural: `git diff --check` — passed; only existing LF-to-CRLF normalization warnings were emitted.
- Final tracked snapshot: `git diff --stat` reported 21 tracked files, 1,219 insertions, and 127 deletions. The final verification observed 16 untracked feature/task files; no verification command added files.
- Manual/browser acceptance: deferred; no browser or dev server was started. Automated component tests cover drag/drop, rollback, selector order, and run-status/assignee preservation.
- Review policy: receipt-driven development is disabled/unmanaged; no native review lifecycle was started.

## ORDER-010 files

- `odd/tasks/case-order-reordering.md`
- Engram mirror: `odd/case-order-reordering/tasks`

## ORDER-009 files

- `frontend/utils/caseOrdering.ts`
- `frontend/utils/caseOrdering.test.ts`
- `frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.tsx`
- `frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/TestCaseTable.test.tsx`
- `frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/CasesPane.tsx`
- `frontend/src/app/[locale]/projects/[projectId]/folders/[folderId]/cases/CasesPane.test.tsx`
- `frontend/src/app/[locale]/projects/[projectId]/runs/[runId]/TestCaseSelector.tsx`
- `frontend/src/app/[locale]/projects/[projectId]/runs/[runId]/TestCaseSelector.test.tsx`
- `odd/tasks/case-order-reordering.md`
- Engram mirror: `odd/case-order-reordering/tasks`

## ORDER-008 files

- `frontend/types/case.ts`
- `frontend/utils/caseControl.ts`
- `frontend/utils/caseControl.test.ts`
- `frontend/utils/caseOrdering.ts`
- `frontend/utils/caseOrdering.test.ts`
- `odd/tasks/case-order-reordering.md`
- Engram mirror: `odd/case-order-reordering/tasks`

## Next step

Feature implementation and automated verification are complete. Manual/browser acceptance remains deferred, and the uncommitted worktree is preserved for inspection and delivery decisions.
