# Task status, and what a blocked task waits on

## Summary

Decided in [ADR 0020](../../adr/0020-task-status-and-derived-blocked.md); built (see "As built"). A task has one status: **todo → in-progress / blocked → review → done**. All five are stored. **Blocked** is assigned with a comment, by the owner or a Thread, and a task also reads as blocked, with nothing written, while a question is unanswered, its Thread has failed, or a task it comes after is open. A blocked task waits on a **human** (the owner or anyone else) or on a **task**. A Thread has its own state, and the board is a view over the three. Part of the design in [the design index](../README.md).

## The problem

The board's seven states mix three things: how far the task is, what holds it, and what its Thread is doing. `blocked` says a task is held but not by what, so the board cannot tell whether a person has to act or the block clears by itself, and one task cannot wait on another by rule. A `todo` task the owner wrote never appears on the board, and nothing answers "what could an agent pick up now".

## Three things, kept apart

| Thing | Values | Where it lives |
| --- | --- | --- |
| Task status | todo, in-progress, blocked, review, done | stored in the task file; blocked is also derived |
| Waiting on, for a blocked task | human, task | derived from why it is blocked |
| Thread state | queued, running, asks, ended, failed | derived from the run and the timeline |

Derived values are computed on every read ([ADR 0006](../../adr/0006-board-derived-from-files.md)).

## Task status

![Task status: todo, in-progress, blocked, review and done. Every fact in it is in this page.](states.svg)

| Status | Means | Moves on |
| --- | --- | --- |
| todo | written, not started | the owner's Start, to in-progress ([ADR 0015](../../adr/0015-only-the-owner-starts-a-thread.md)) |
| in-progress | a Thread is queued or running, or the owner is doing it by hand | the Thread's report, to review |
| blocked | it cannot move until something outside it does | Unblock, or the cause clearing, back to todo or in-progress |
| review | the work is reported | Accept, to done; Send back, to in-progress |
| done | accepted | Reopen, to todo |

`doing` is renamed `in-progress`.

## Blocked: assigned or derived

| How | Waiting on | Because | Clears when | Detail line |
| --- | --- | --- | --- | --- |
| assigned | human | the owner or a Thread set `blocked`, with a comment | Unblock | the comment: "Dana has to approve the API" |
| derived | human | a `question` event is unanswered | the owner's note | the question |
| derived | human | `in-progress`, every Thread ended, no report | Continue or Drop | "failed: …" or "ended without a report" |
| derived | task | a task in `after` is not done, or a subtask is not done | by itself, when that task is done | "T-005 (in-progress)" |

- **Assigning** sets the status to `blocked` and writes a comment on the timeline saying who or what it waits on; the comment is required. The owner does it from the board or the task; a Thread does it when it is held by something a note from the owner cannot settle, and asks a question otherwise.
- **Unblock** sets `in-progress` if the task has had a Thread, else `todo`. On a task a Thread blocked, Unblock is Continue: the owner's note carries on the work.
- **A derived block writes nothing**, so nothing has to clear it and it cannot go stale; the stored status stays `todo` or `in-progress`.
- **`after: T-005, other-slug/T-004`**, comma-separated task addresses. Each is a typed "after" edge in the graph, read both ways, so T-005's card shows what it holds up; an address that resolves to nothing does not hold. Open subtasks hold their parent without the field.

Human comes first when a task is blocked both ways, since someone can act on it now.

## Thread state

| State | Derived from |
| --- | --- |
| queued | its run is `queued` |
| running | its run is `running` |
| asks | its latest `question` has no note from the owner after it |
| ended | its run finished |
| failed | its run failed, was stopped or was interrupted, and no later Thread continues it |

A Thread blocks its task by asking, by failing, or by assigning `blocked` before it ends.

## The board is a view

| Group | Tasks in it | Actions |
| --- | --- | --- |
| Waiting on human | blocked, waiting on human; and review | Answer; Continue or Drop; Unblock; Accept or Send back |
| Working | in-progress, a Thread queued or running | Steer, Stop, Block |
| Ready | todo, not blocked | Start, Block |
| Waiting on task | blocked, waiting on task | none; it shows the task it waits on |

An in-progress task with no Thread ever (the owner doing it by hand) stays off the board, as now. Ready is sorted by priority, then due date; past eight rows it shows a count. `GRAPH.md` puts the status on each task's card, derived blocks included, so the cards that read `todo` are what an agent can take.

Migration, once: `doing` becomes `in-progress`. Stored `blocked` tasks stay as they are; their latest comment is the reason.

## Checked against other systems

Read on 2026-11-24 from each system's own docs or spec, except where marked.

| System | What it does | Here |
| --- | --- | --- |
| [Beads](https://github.com/steveyegge/beads), an issue tracker for coding agents | `bd ready` lists open issues with no open blocker. Of its dependency types only `blocks` holds work back; the rest (`discovered-from`, parent links) add context. Claimed and deferred issues are left out of ready. It also stores `blocked` as a status (statuses from a secondary summary) | Taken: ready is derived from a typed dependency, and only `after` holds a task by rule; mentions add context, as [the graph](../graph.md) already says. Also the same: a stored `blocked` beside the dependency |
| [Taskwarrior](https://taskwarrior.org/docs/tags/) | Ready, blocked and waiting are virtual tags, computed and never stored. BLOCKED means "dependent on another incomplete task"; READY means pending and not blocked; WAITING is a date that hides the task until then | Same idea: derived states from one stored status plus `depends`. Its BLOCKED is our blocked, waiting on task. A wait-until date is left out |
| [Linear agent sessions](https://linear.app/developers/agent-interaction) | Six session states, set by Linear from the agent's last activity: pending, active, awaitingInput, error, complete, stale. An "elicitation" (question) or an error both mean the agent needs the user | Agrees: a question and a failure both make the task blocked, waiting on human, derived from what the agent last wrote. Their awaitingInput is our question event |
| [Linear delegation](https://linear.app/docs/assigning-issues) | A delegated issue keeps a human as its assignee; the agent works on their behalf and the human stays accountable | Agrees with ADR 0015: the owner starts and answers for every Thread |
| [Linear workflow](https://linear.app/docs/configuring-workflows) | Any number of custom statuses, each in one of six fixed types: triage, backlog, unstarted, started, completed, canceled | The same move as ours: many reasons, few statuses, ordered by how far along the work is |
| [Jira](https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-statuses-priorities-and-resolutions/) | Three fixed status categories: To Do, In Progress, Done. Atlassian declined to add a blocked category (per a community thread) | A blocked custom status is filed under In Progress, so reports cannot tell waiting from work. That is why blocked is its own status here, beside in-progress |
| [OpenAI Symphony](https://github.com/openai/symphony/blob/main/SPEC.md) | Linear's statuses are the state machine. An issue is dispatched when its state is in `active_states`, the adapter marks it `dispatchable` (blockers are folded in there), it is unclaimed and a slot is free. A successful run ends in a handoff state such as "Human Review". A run "MUST NOT stall indefinitely waiting for user input"; the example policy fails it. The agent moves the issue's state, not the orchestrator | Their dispatchable is our `todo`, which is never blocked. They start work automatically; Loom does not (open question 1). Their handoff is our review. A failed run makes the task blocked, waiting on human, as their failing policy would |
| Kanban practice ([one write-up](https://medium.com/the-pragmatic-agilists/stop-using-a-blocked-state-column-57496af15589); blog posts, not a standard) | A blocked flag on the card, not a blocked column: work in a blocked column stops being looked at, and its place in the flow is lost | Partly followed: a block on a task is a flag (`after`) and the stored status keeps the task's place. An assigned block is a status, because the owner and a Thread need one they can set; its comment and its board group keep it in view |

What no system above does: say with every block whether it waits on a human or on a task, so the owner sees which rows someone must clear and which clear by themselves.

## What changes

| Place | Change |
| --- | --- |
| `types.ts` | `TASK_STATUSES`: todo, in-progress, blocked, review, done; `THREAD_STATES`: queued, running, asks, ended, failed; a task gains `after` |
| `store.ts` | parse `after`; derive blocked and what it waits on; the "after" edge and the status on the card; setting `blocked` requires a comment; the `doing` rename |
| `index.ts` `board()` | the four groups above, from task status and Thread state; questions read per task, not only per Thread |
| `prompts.ts` | ask when a note from the owner settles it; otherwise set `blocked` with a comment; `after` for a task |
| `conventions.md`, `skills/loom`, `web/ui.tsx` | the five statuses and `after`; "what should I work on" leading with waiting on human, then todo |
| `Today.tsx` | the four groups, "Needs you" renamed "Waiting on human"; Block and Unblock |

## Open questions

1. **Start when unblocked?** The owner could approve a task that is still blocked on a task, and the server would queue it once that clears. It is how Symphony runs, and it amends ADR 0015; not in this proposal.

## As built

`blockOf` and `threadsOf` in `store.ts` derive a block for the board, `GRAPH.md` and the Shuttle's ledger alike; `board()` in `index.ts` groups the rows. Choices made where this page is silent:

- **The order of the checks** is assigned, then question, then Threads ended, then `after` and subtasks; the first that holds is the one shown. A `done` task is never blocked. A `review` task can be held only by a question: reported work waits on the owner, not on other tasks.
- **A question is answered** by an owner's note written after it in the timeline, to the task or to the Thread that asked; order in the file, not the timestamp, decides.
- **A report** is a comment signed by a Thread (or `agent`) after the latest Thread started. A Thread that ended with a report but left the task `in-progress` is not blocked and stays off the board, like work by hand. The Thread prompt asks for `review` when it stops short.
- **The assigned reason** is the latest timeline comment, the same rule the migration uses. `PATCH` and task creation take a `comment`, written to the timeline; it is required when the status becomes `blocked` (a 400 otherwise). A Thread editing the file directly is asked to start its report with the reason; the server cannot refuse a file edit.
- **A Thread blocked the task** when the latest status event to `blocked` is signed by a Thread address. Unblock is `POST …/tasks/<id>/unblock` with optional text: for such a task it sets `in-progress` and sends the owner's note (the text, or "Continue from where you stopped"); otherwise it sets `in-progress` or `todo` and writes the text as a comment.
- **Board rows.** A live Thread always has its own Working row (Steer, Stop, Block), even when its task is also waiting on a human, so it can still be stopped. A task waiting on a task with a live Thread stays under Working. `T-000` is never on the board. Rows are sorted by priority and due date in every group, so a task's Threads sit together. Answer, Continue and Unblock notes go to the task, not one Thread; only Steer names its Thread.
- **Block** on a working task sets `blocked` with the comment and leaves the Thread running; Stop is separate.
- **`after`** is stored as a comma-separated frontmatter value and read as a list. Each address must look like `T-nnn` or `slug/T-nnn`; whether it resolves is not checked on write. Its edge is marked `missing` in `GRAPH.md` when it resolves to nothing, and grepping a task's address returns the `after` edges pointing at it, which is how a card shows what it holds up. A change to `after` is not logged as a `field` event.
- **The `GRAPH.md` card** reads `blocked` for a derived block and adds `waiting on human: "…"` or `waiting on task: "…"`. A Thread's card keeps its run status.
- **The task page** asks for the comment in a prompt when the status is set to Blocked, and has an After field. Task rows show `after T-005` links.
- **Migration** runs at startup with the `project.json` one: a task whose frontmatter `status` is `doing` is rewritten to `in-progress`; its timeline keeps the old events.
