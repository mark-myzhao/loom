# Architecture decision records

One file per decision, numbered in the order they were made. The design itself is in [`../design`](../design/README.md); these say what was chosen and why.

| # | Decision | Status | Implementation |
| --- | --- | --- | --- |
| [0001](0001-record-design-decisions.md) | Record design decisions as ADRs | Accepted | Built |
| [0002](0002-shuttle-sessions-are-disposable.md) | A Shuttle session is disposable | Accepted; amended by 0014 | Built |
| [0003](0003-code-writes-the-hand-over.md) | Code writes the hand-over, not the model | Accepted | Built |
| [0004](0004-no-keep-warm-pings.md) | Let the prompt cache expire | Accepted | Decided |
| [0005](0005-threads-start-from-an-index.md) | A Thread starts from an index, and documents stay small | Accepted; amended by 0016 and 0023 | Built |
| [0006](0006-board-derived-from-files.md) | The board is derived from files, and a finished Thread does not wake the Shuttle | Accepted; amended by 0013, 0015, 0017 and 0020 | Built |
| [0007](0007-notes-reach-a-running-thread.md) | One note endpoint, addressed by task, reaches a running Thread | Accepted; amended by 0012 and 0017 | Built |
| [0008](0008-shuttle-may-send-notes.md) | The Shuttle may send notes on its own judgement | Accepted; amended by 0012 | Built |
| [0009](0009-five-words.md) | Five words and two marks | Accepted; amended by 0017 and 0019 | Built |
| [0010](0010-usage-from-session-totals.md) | Usage is recorded per session start, from the transcript's running totals | Accepted; amended by 0030 | Built |
| [0011](0011-shuttle-permissions-allow-list.md) | The Shuttle's permissions are an allow-list | Accepted; amended by 0015 and 0026 | Built |
| [0012](0012-server-sets-note-author.md) | The server sets a note's author, and only the owner's note starts a session | Accepted | Built |
| [0013](0013-broken-is-derived.md) | Broken is derived from the run, and blocked keeps its meaning | Accepted; amended by 0020 | Built |
| [0014](0014-first-version-scope.md) | Scope of the first version | Accepted; amended by 0017 | Decided |
| [0015](0015-only-the-owner-starts-a-thread.md) | Only the owner starts a Thread | Superseded by 0027 | Built |
| [0016](0016-one-graph-derived-from-files.md) | One graph, derived from files | Accepted | Partly built |
| [0017](0017-several-threads-weave-a-task.md) | Several Threads may weave one task | Accepted | Partly built |
| [0018](0018-a-project-is-a-task.md) | A project is a task, and sources and repos are artifacts | Accepted | Partly built |
| [0019](0019-shuttle-page-and-live-graph.md) | The Shuttle has its own page, a new mark, and the dashboard draws the graph | Accepted | Built |
| [0020](0020-task-status-and-derived-blocked.md) | Five task statuses, and blocked is assigned with a comment or derived | Accepted; amended by 0021 | Built |
| [0021](0021-cancelled-task-status.md) | A sixth task status, cancelled | Accepted | Built |
| [0022](0022-local-action-telemetry.md) | Owner and agent actions are logged locally, outside the snapshot history | Accepted | Built |
| [0023](0023-markdown-is-the-source.md) | Markdown is the source; HTML is only a visual a markdown document links | Accepted; amended by 0024 | Built |
| [0024](0024-layout-markers.md) | Documents get their look from a few layout markers the app draws | Accepted | Built |
| [0025](0025-skills-a-thread-loads.md) | Threads load Loom's own skills from a plugin in the checkout | Accepted | Built |
| [0026](0026-shuttle-writes-through-the-api.md) | The Shuttle changes Loom only through its API | Accepted | Built |
| [0027](0027-shuttle-starts-a-thread-the-owner-asks-for.md) | The Shuttle starts a Thread the owner asks for, and the ask and generate errands retire | Accepted | Built |
| [0028](0028-a-thread-opens-a-pull-request.md) | A Thread opens a pull request when its work is ready | Accepted | Built |
| [0029](0029-a-pin-is-artifact-metadata.md) | A pin is a line of the artifact's own metadata | Accepted | Built |
| [0030](0030-estimate-unpriced-stretches.md) | A stretch Claude Code never priced gets a rough, rule-based estimate | Accepted | Built |

## Adding one

Copy the shape of an existing file: a title, then Status, Date, Implementation and Design lines, then `## Context`, `## Decision`, `## Consequences`. Keep it under about 250 words; detail belongs in the design page it links.

- Status is `Proposed`, `Accepted`, `Accepted; amended by NNNN`, or `Superseded by NNNN`.
- An accepted ADR is not rewritten. To change a decision, add a new ADR and set the old one's status to superseded, or to amended when only part of it changes. The Status and Implementation lines are the only ones updated in place.
- Add the row to the table above and update the design page in the same change.
