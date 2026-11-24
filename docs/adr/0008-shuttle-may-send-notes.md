# 0008. The Shuttle may send notes on its own judgement

- Status: Accepted; amended by 0012
- Date: 2026-11-23
- Implementation: Not built
- Design: [threads/notes.md](../design/threads/notes.md)

## Context

With notes available, the question was whether the Shuttle may send one unasked, for example to tell a running Thread that another Thread renamed something it depends on.

## Decision

It may. The limits of ADR 0007 stay: 100 words, labelled as the Shuttle's, and no authority to widen or change what the Thread was asked to do. A Shuttle note is a fact to weigh; only the owner's note changes the task.

## Consequences

Threads learn of each other's results without the owner relaying them. The Shuttle can only act during a pick, so in practice this happens when the owner's next message arrives. A Thread's brief must state the difference between the two labels.
