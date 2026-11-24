# 0006. The board is derived from files, and a finished Thread does not wake the Shuttle

- Status: Accepted; amended by 0013, 0015 and 0017
- Date: 2026-11-23
- Implementation: Built
- Design: [threads/dispatch.md](../design/threads/dispatch.md)

## Context

The owner needs to see what every Thread is doing without asking. Routing each status change through the Shuttle would cost a model call per event and make the board only as current as the last call.

## Decision

The Shuttle writes a task and dispatches a Thread without waiting. The Threads board on Today is computed from task files and run records; a Thread's state (proposed, queued, running, asks, slow, broken, review) is derived, never stored. A finishing Thread does not start a Shuttle turn: the Shuttle learns of it in the envelope of the owner's next message.

## Consequences

The board is live and free. Chains such as "when the research finishes, start the build" do not happen by themselves; if a real one is wanted, that needs a `SHUTTLE.md` rule, a paid pick and a new ADR.
