# UnitTCMS agent instructions

## Project skills

- Load `skills/subagent-timeout-guard/SKILL.md` before delegating implementation, testing, builds, browser checks, or any potentially long-running worker. Do not wait indefinitely for a pending subagent; use its bounded budgets and recovery gates.
