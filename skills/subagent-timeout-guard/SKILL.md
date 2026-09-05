---
name: subagent-timeout-guard
description: "Trigger: subagent blocked, worker timeout, verification hanging, task pending, agent stuck. Keep delegated work bounded, observable, and recoverable."
license: Apache-2.0
metadata:
  author: "Daniel Rondon Garcia"
  version: "1.0"
---

## Activation Contract

Load this skill before delegating implementation, tests, builds, browser checks, or any worker that can remain pending. Activate it again when a worker is empty, malformed, cancelled, or has exceeded its budget.

## Hard Rules

- Never launch unbounded work. Define one objective, one fingerprint, one wall-clock budget, one success signal, and one fallback before launch.
- Use bounded shell/tool calls (maximum 120 seconds each). Split longer commands instead of increasing a timeout silently.
- Use these default wall-clock budgets: quick check 5 minutes, mapping or implementation batch 20 minutes, build/browser batch 15 minutes. Split larger work into named batches.
- Never wait silently beyond the budget. Stop polling, preserve the repository, report the blocked phase and elapsed budget, and continue only through a safe fallback or an explicit user decision.
- Do not automatically relaunch the same worker after timeout, cancellation, empty output, or malformed output. A new attempt needs a new fingerprint and a stated reason.
- Never claim verification from a pending or missing worker result. Re-check `git status` and the diff before using partial work.

## Decision Gates

| Result | Action |
| --- | --- |
| Complete and structured | Validate the declared files, commands, and success signal; then continue. |
| Partial but readable | Preserve it, verify concrete claims, and run only the smallest missing bounded check. |
| Pending past budget | Stop waiting; surface the blocker and use the fallback or ask the user. |
| Empty, malformed, cancelled, or failed | Do not retry automatically; inspect repository state and report the exact failure. |

## Execution Steps

1. Record the objective, budget, expected result, and fallback in the delegation prompt.
2. Launch exactly one worker for the bounded work unit; do not hide dependent work inside it.
3. Poll only within the declared budget. If the runtime has cancellation, cancel the overdue worker; otherwise stop polling and return control to the orchestrator.
4. Validate result shape, files, commands, and repository state. Treat unknown outcomes as blocked.
5. For tests/builds/browser sessions, close the session/process after the bounded check; never leave a server or browser running as a prerequisite for delivery.

## Output Contract

Return `status`, `objective`, `elapsed_budget`, `result`, `evidence`, `fallback_or_next_step`, and `skill_resolution`. Name environment blockers separately from confirmed code failures.

## References

- `../../AGENTS.md` — project registration and loading rule.
