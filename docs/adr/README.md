# Architecture decision records

One file per decision, numbered in the order they were made. The design itself is in [`../design`](../design/README.md); these say what was chosen and why.

| # | Decision | Status | Implementation |
| --- | --- | --- | --- |
| [0001](0001-record-design-decisions.md) | Record design decisions as ADRs | Accepted | Built |
| [0002](0002-shuttle-sessions-are-disposable.md) | A Shuttle session is disposable | Accepted; amended by 0014 | Built |
| [0003](0003-code-writes-the-hand-over.md) | Code writes the hand-over, not the model | Accepted | Built |
| [0004](0004-no-keep-warm-pings.md) | Let the prompt cache expire | Accepted | Decided |
| [0005](0005-threads-start-from-an-index.md) | A Thread starts from an index, and documents stay small | Accepted; amended by 0016 | Not built |
| [0006](0006-board-derived-from-files.md) | The board is derived from files, and a finished Thread does not wake the Shuttle | Accepted; amended by 0013, 0015 and 0017 | Not built |
| [0007](0007-notes-reach-a-running-thread.md) | One note endpoint, addressed by task, reaches a running Thread | Accepted; amended by 0012 and 0017 | Not built |
| [0008](0008-shuttle-may-send-notes.md) | The Shuttle may send notes on its own judgement | Accepted; amended by 0012 | Not built |
| [0009](0009-five-words.md) | Five words and two marks | Accepted; amended by 0017 | Not built |
| [0010](0010-usage-from-session-totals.md) | Usage is recorded per session start, from the transcript's running totals | Accepted | Built |
| [0011](0011-shuttle-permissions-allow-list.md) | The Shuttle's permissions are an allow-list | Accepted; amended by 0015 | Built |
| [0012](0012-server-sets-note-author.md) | The server sets a note's author, and only the owner's note starts a session | Accepted | Not built |
| [0013](0013-broken-is-derived.md) | Broken is derived from the run, and blocked keeps its meaning | Accepted | Not built |
| [0014](0014-first-version-scope.md) | Scope of the first version | Accepted; amended by 0017 | Decided |
| [0015](0015-only-the-owner-starts-a-thread.md) | Only the owner starts a Thread | Accepted | Partly built |
| [0016](0016-one-graph-derived-from-files.md) | One graph, derived from files | Accepted | Not built |
| [0017](0017-several-threads-weave-a-task.md) | Several Threads may weave one task | Accepted | Not built |
| [0018](0018-a-project-is-a-task.md) | A project is a task, and sources and repos are artifacts | Accepted | Not built |

## Adding one

Copy the shape of an existing file: a title, then Status, Date, Implementation and Design lines, then `## Context`, `## Decision`, `## Consequences`. Keep it under about 250 words; detail belongs in the design page it links.

- Status is `Proposed`, `Accepted`, `Accepted; amended by NNNN`, or `Superseded by NNNN`.
- An accepted ADR is not rewritten. To change a decision, add a new ADR and set the old one's status to superseded, or to amended when only part of it changes. The Status and Implementation lines are the only ones updated in place.
- Add the row to the table above and update the design page in the same change.
