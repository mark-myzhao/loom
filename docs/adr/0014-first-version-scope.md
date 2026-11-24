# 0014. Scope of the first version

- Status: Accepted
- Date: 2026-11-23
- Implementation: Decided; nothing to build
- Design: [roadmap.md](../design/roadmap.md)

## Context

The design review listed parts that add machinery without changing what the owner sees at first. The owner asked for the review's feedback to be applied.

## Decision

Left out of the first version: swapping a warm bobbin at a context budget (ADR 0002 keeps the cold-cache swap; compaction is the backstop); the "slow" Thread state; the note sent automatically when a task with a live Thread is edited; artifact tabs on the task page. A Thread resumes when its cache is warm and restarts from files when it is cold, with no size test. Kept, against the review's suggestion and pending the owner's word: the Shuttle sending notes on its own judgement (ADR 0008), markdown renderings of HTML artifacts (ADR 0005), and the chart-based Usage page.

## Consequences

Fewer triggers and states to build and test. A budget, if the usage numbers call for one, is a new ADR. The pictures page still draws the budget swap and the slow state.
