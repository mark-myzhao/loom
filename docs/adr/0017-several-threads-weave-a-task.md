# 0017. Several Threads may weave one task

- Status: Accepted
- Date: 2026-11-24
- Implementation: Partly built: Thread addresses, notes by address, the next Thread on a cold note, a board row per Thread, a further Thread on Start (roadmap steps 5 and 6); no "continues" edge
- Design: [graph.md](../design/graph.md)

## Context

ADR 0009 and rule T5 define a Thread as "the agent working one task", identified by the task. The graph design first followed that and gave a Thread no node of its own. The owner asked not to assume one Thread per task: several may weave it, such as a build, a review and a second attempt.

## Decision

A Thread is a node with its own address, the task id and a number (`T-006.2`), derived from the order Threads started on the task's timeline. It is one run of an agent, resumed while its cache is warm. Work picked up cold is the next Thread, which continues the earlier one from its report, in the same worktree for code. Threads may also run side by side. A different deliverable is still a subtask. The task's timeline is the record that ties its Threads and what they wrote together.

## Consequences

If accepted, these pages change: the glossary's Thread row; T5, where a cold restart becomes a new Thread that continues the old one; the board, which shows a row per Thread grouped by task; notes, which reach every running Thread of a task or one Thread by address; and the `question` field, which becomes a `question` event on the timeline, authored by the Thread and cleared by the owner's note. Timeline authors become Thread addresses. Two Threads can edit one task file; that is an open question in the design page. Only the owner starts each Thread (ADR 0015), so the number of Threads is the owner's choice.
