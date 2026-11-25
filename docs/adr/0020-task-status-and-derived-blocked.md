# 0020. Five task statuses, and blocked is assigned with a comment or derived

- Status: Proposed
- Date: 2026-11-24
- Implementation: Not built
- Design: [threads/states.md](../design/threads/states.md)

## Context

The board's seven derived states mix how far a task is, what holds it and what its Thread is doing. `blocked` says a task is held but not by what, so the board cannot tell whether a person has to act or the block clears by itself, and one task cannot wait on another by rule.

## Decision

A task's status is todo, in-progress, blocked, review or done, all stored; `doing` is renamed `in-progress`. Blocked is assigned by the owner or a Thread, always with a comment saying who or what it waits on, and cleared by Unblock. A task also reads as blocked, with nothing written, while a question is unanswered, its Threads have ended without a report, or a task in a new `after` field (or a subtask) is open. A blocked task waits on a human, the owner or anyone else alike, or on a task, which clears by itself. A Thread's state (queued, running, asks, ended, failed) is kept apart from the task's, and the board's groups are a view over both. Only the owner starts a Thread (ADR 0015). This replaces the state order of ADR 0013.

## Consequences

Every block carries its reason and whether a human has to act. A derived block cannot go stale; an assigned one still needs someone to clear it. Stored `doing` is migrated once. The board's seven states become four groups. Starting a task once it unblocks would amend ADR 0015 and is left open.
