# 0032. A Thread that ends wakes the Shuttle

- Status: Accepted
- Date: 2026-11-27
- Implementation: Built
- Design: [shuttle/context.md](../design/shuttle/context.md) (R7), [threads/dispatch.md](../design/threads/dispatch.md)

## Context

ADR 0027 began every Shuttle turn with a message from the owner, so a Thread's end reached the Shuttle only in the envelope of the owner's next message, and a follow-on the owner had approved waited for them to write. The owner asked for the Shuttle to hear Threads end, and for a woken Shuttle to start a follow-on they approved in advance.

## Decision

When a Thread's run ends, fails or stops on a question, Loom gives the Shuttle a turn: the runs that ended since its last reply, and no words from the owner after the `---`. A Thread that ends mid-turn waits for the turn to finish, and the next turn carries it.

In a turn the owner began, the Shuttle may record an approval on a task that waits on another (`after`): the `thread` tool's `approve` action writes `approved to start after …` on its timeline. In a woken turn the server accepts a start from the Shuttle only for a task whose approval is newer than its last start and whose `after` names a task whose Thread woke it; it refuses new approvals. The start spends the approval. Anything else a report asks for, the woken Shuttle tells the owner rather than does.

## Consequences

Each Thread end costs a Shuttle turn, cheap while its cache is warm and a hand-over when it is cold; there is still no keep-warm ping (ADR 0004). A follow-on chain needs no owner message between links. As in ADR 0027, the approval is recorded on the Shuttle's word in a turn the owner began, so code bounds it to that turn, not to the owner's words in it.
