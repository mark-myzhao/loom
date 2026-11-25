# 0021. A sixth task status, cancelled

- Status: Accepted
- Date: 2026-11-25
- Implementation: Built
- Design: [threads/states.md](../design/threads/states.md)

## Context

A task that will not be done, because its plan changed or another task covered it, can only be marked done, which claims work that did not happen, or left open, where it stays on the board and holds every task that comes after it.

## Decision

`cancelled` is a sixth stored status, closed like `done`: it is never blocked, holds no task in `after` or parent, stays off the board, counts as closed in subtask progress, and a cancelled root reads as a done project. The reason goes in a timeline comment. Reopen sets `todo`. This amends ADR 0020.

## Consequences

Closed work says whether it was done or dropped. Every place that asked "is it done" to mean "is it open" now asks "is it closed".
