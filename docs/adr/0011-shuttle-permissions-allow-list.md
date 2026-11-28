# 0011. The Shuttle's permissions are an allow-list

- Status: Accepted; amended by 0015, 0026 and 0031
- Date: 2026-11-23
- Implementation: Built
- Design: [shuttle/context.md](../design/shuttle/context.md)

## Context

The first Shuttle may write anywhere in the data directory and call any `/api/*` route. That reaches `automations.json`, `config.json` and the route that runs an automation, and a command automation runs a shell. The design feeds the Shuttle text it did not write: Thread questions, report lines, task bodies ingested from web pages. A design review found that an induced Shuttle could give itself a shell.

## Decision

The Shuttle may write only under `projects/` and to `SHUTTLE.md`, and may call only a named list of routes: tasks, comments, delegate, note, ask, ingest, generate, stop, read a task. No config and no automations. A `SHUTTLE.md` line that lets it start Threads unasked is written only when the owner says so in their own message, and is quoted back.

## Consequences

What the Shuttle can do no longer depends on it behaving. Adding a Shuttle capability means adding a route to the list. The spending rule is a prompt rule, not enforced; unwanted starts show on the Usage page.
