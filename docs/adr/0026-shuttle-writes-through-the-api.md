# 0026. The Shuttle changes Loom only through its API

- Status: Accepted
- Date: 2026-11-26
- Implementation: Built
- Design: [shuttle/context.md](../design/shuttle/context.md) (R7)

## Context

ADR 0011 let the Shuttle write files under `projects/` and `SHUTTLE.md`, because the task routes signed every caller as the owner. So the Shuttle hand-wrote frontmatter and timeline events, and the formats held only while it followed `CLAUDE.md`. Its file-write rules also failed in practice: after a `cd` in Bash they stopped matching for the rest of the turn (cause unconfirmed), and the owner saw "permission was refused".

## Decision

The Shuttle has no Edit or Write. It reads files and changes them through listed routes: create and patch a task, tick a checklist item, create and replace a memory entry, and replace its notebook (`PUT /api/shuttle/notebook`, at most 40 lines). The server writes the files and their timeline events.

The task routes sign the owner's token `me` and any other caller `shuttle`. Only the dashboard and the Shuttle call them; Threads write their files. A Shuttle token was rejected: Claude Code refuses a command that expands a variable, and a literal token would be saved in run records.

A curl allow rule can be bent to reach a route it does not name, so the server refuses `PUT /api/config`, creating or editing an automation, and every `DELETE` without the owner's token.

## Consequences

The file formats are enforced by code for the Shuttle too, and a `cd` cannot refuse its writes. A new tokenless caller of the task routes would be signed `shuttle`. Running a saved automation stays open, for the terminal skill. Any local process can still forge the dashboard's request for the owner's token.
