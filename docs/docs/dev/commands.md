---
sidebar_position: 2
---

# Commands

Following commands are useful for unittcms development.
(Setting up a server directly from source, please refer to the following link: [Running UnitTCMS from Source](../getstarted/from-source.md))

## Frontend

| commands      | description                         |
| ------------- | ----------------------------------- |
| `npm run dev` | Start frontend server with dev mode |

## Backend

| commands          | description                        |
| ----------------- | ---------------------------------- |
| `npm run dev`     | Start backend server with dev mode |
| `npm run migrate` | Set up database                    |
| `npm run drop`    | Drop tables                        |
| `npm run seed`    | Insert seed data                   |

## Automation verification

| command                               | description                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run e2e:gherkin:fake`            | Run the localized Gherkin flow with intercepted fake/injected automation responses                     |
| `npm run hercules:compatibility:real` | Opt-in pinned Hercules browser/LLM gate; requires CI-injected LiteLLM credentials and target allowlist |
