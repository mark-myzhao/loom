# Dispatch and the Threads board

## Summary

The Shuttle writes a task file and replies; the owner starts a Thread on it from the board with one click, and may start more than one. The Threads board on Today is derived from task files and run records, so it is live and costs no model call; a Thread's state is never stored. Only the owner starts a Thread; they also edit, steer, answers, stops or drops from the board. A note, at most 100 words, reaches a Thread even while it runs, through one endpoint addressed by task; the owner or the Shuttle can send one, and it is recorded on the timeline first; see [Notes](notes.md). Part of the design in [the design index](../README.md).

## The flow

The Shuttle turns what the owner says into task files. It does not start Threads and never waits for one: a pick ends as soon as the files are written. The owner presses Start on the board, and from there the files carry the state.

[Diagram: Flow from owner through Shuttle and task files to Threads and back to the board; drawn in [the pictures](../pictures.html).]

*Figure: Solid arrows are writes and reads of files. The dashed line is the owner acting on the board directly; those actions change a task file or message a Thread and never pass through the Shuttle.*

## How a dispatch goes

1. **Write the task.** One task per deliverable, as a subtask when it belongs to a larger one. The task file is the brief; there is no second "assignment" object.
2. **Pick the kind of Thread from the task.** A task with a `repo` gets a coding Thread in a worktree; a task without one gets a document Thread that writes an artifact. Notes and links still go to ingest, which is an errand and not a Thread.
3. **Leave it for the owner to start.** The task sits as `todo` with a Start button on the board: the Shuttle proposes, the owner edits the task if they want, then starts it. This holds even when the owner asked for the work in the conversation: starting a Thread is the one thing that spends real money, so it takes the owner's own click (R7 in [The Shuttle's context and cache](../shuttle/context.md)). The server enforces it; no standing instruction can lift it.
4. **Reply and stop.** "Wrote T-012 to T-014; they are on the board for you to start." Links, no waiting.
5. **Code closes the loop.** Nothing is written to the task when a run ends badly: the board derives "broken" from the run record, so `blocked` keeps its one meaning (waiting on someone, set by the owner or by the agent itself). The hook that records what a run changed must fire on every finish, resumes included; today `sendMessage` resumes without it, so a resumed Thread's changes go unlogged.

The Shuttle is still not woken by a finishing Thread. The board already shows the result, and a wake-up is a paid pick that may land on a cold cache. Results reach the Shuttle in the envelope of the owner's next message, as today.

## The board

The Threads board leads Today and replaces the list of live runs; the Shuttle has its own page in the rail ([ADR 0019](../../adr/0019-shuttle-page-and-live-graph.md)). It absorbs the "Needs you" list. An empty group takes no space.

Groups, in order: **Needs you** (asks, broken, blocked, review), **Running**, **Waiting to start** (proposed, queued). There is one row per Thread, grouped under its task; a task with no Thread yet has one row. Each row shows the Thread mark in its state colour, the task id and title, a state tag, one line of detail (the question, or turns, time, context size and last action) and its actions. The Shuttle header above shows the bobbin's context against the budget and whether the cache is warm. Mock-up in [the pictures](../pictures.html), which still draws a "slow" state that is not in the first version.

The detail line needs figures while a Thread runs. Today a run's turns update only when its session stops and its cost and peak context only when it ends, so `runs.ts` must update turns and peak context as transcript lines arrive.

## A Thread's state is derived, never stored

The first row that matches is the state shown:

| Shown as | Derived from | The owner can |
| --- | --- | --- |
| asks | The Thread's latest `question` event on the timeline has no note from the owner after it | Answer (resumes it, or starts the next Thread, per T5) |
| running | Its run is `running` | Steer, stop, edit the task |
| queued | Its run is `queued` | Cancel; raise the task's priority to move it up the queue |
| broken | Task is `doing`, the Thread's run failed, was stopped or was interrupted, and no later Thread continues it | Continue from the files, or drop |
| blocked | Task is `blocked`: waiting on someone, as today | Read the reason on the timeline; send a note or edit the task |
| review | Task `review` | Accept (done), or send back with a comment |
| proposed | Task is `todo`, written by the Shuttle, no run | Start (the only way a Thread begins), edit, drop |

A "slow" state for a Thread running past a turn or time threshold is left out of the first version; the detail line shows turns and time, and the Usage page shows what a long run cost.

No new status field and no Thread record: these are a function of the task file, its timeline and its runs ([The graph](../graph.md)), which is what keeps a task from showing `doing` with nothing running.

## As built

Step 6 built the board in `board()` beside `talkToShuttle`, and the Shuttle's ledger is the same rows, one line per task. Choices made where this page is silent:

- **Only a task's latest Thread takes the task's state** (broken, blocked, review). An earlier Thread shows only while it asks, runs or is queued, so a task with three finished Threads has one row.
- **A task with no Thread** shows when it is `blocked` or `review`, or as proposed when it is `todo` and its `created` event is signed `shuttle`. Other `todo` tasks stay in the task lists, not on the board.
- **A question is answered** by the owner's note to the task or to that Thread, written after it.
- **The detail line** is the question; turns and peak context for a running Thread; the run's error for a broken one; the latest comment (the report) for review and blocked; the Context for a proposed task.
- **Actions:** Answer, Steer and Note send a note; Send back sets `doing` and sends one; Continue sends the owner's note to carry on (resuming or starting the next Thread); Stop and Cancel stop the run; Accept sets `done`; Drop moves the task to the trash; Start delegates with a one-line purpose, kept on the run record and shown on the Thread's card.
- **Errands** (ingest, ask, documents) are not Threads and no longer show on Today; the Shuttle reports them.
