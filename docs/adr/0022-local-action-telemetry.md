# 0022. Owner and agent actions are logged locally, outside the snapshot history

- Status: Accepted
- Date: 2026-11-25
- Implementation: Built
- Design: [usage/telemetry.md](../design/usage/telemetry.md)

## Context

Token usage says what the agents cost, not how the system is used: which pages the owner opens, what they do by hand that the Shuttle could do, how long finished Threads wait for review. The task files record what was decided, not the clicks and visits around it.

## Decision

Loom appends one JSON line per action to `telemetry/<day>.jsonl` in the data directory: views and clicks from the dashboard, every non-`GET` API request with its actor, and each run's start and end. Text is never copied, only its length. The folder is in the data directory's `.gitignore`, so it stays out of snapshots and their remote. `config.telemetry` turns it off; it is on by default. The Usage page's Activity section and `bun run telemetry` report it.

## Consequences

Retro questions about how Loom is used get numbers. The log is local-only and is lost with the machine unless copied by hand. Buttons whose text is data need a `data-track` label.
