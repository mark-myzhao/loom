# 0013. Broken is derived from the run, and blocked keeps its meaning

- Status: Accepted
- Date: 2026-11-23
- Implementation: Built
- Design: [threads/dispatch.md](../design/threads/dispatch.md)

## Context

ADR 0006's design set a task to `blocked` when its run failed, was stopped or was interrupted. `blocked` already means the owner is waiting on someone else, and agents set it themselves when they cannot finish. One status would have carried two meanings, and the order between a question, a failure and a review was undefined. Resumed runs also fire no completion hook, so nothing would have set it for them.

## Decision

The board shows "broken" when a task is `doing` and its latest run failed, was stopped or was interrupted; nothing is written to the task. `blocked` is shown as its own state. The first matching state wins, in this order: asks, running, queued, broken, blocked, review, proposed. The hook that records a run's changes fires on every finish, resumes included.

## Consequences

No status changes meaning and no state can go stale, because none is stored. `runs.ts` must keep the hook per run instead of per start.
