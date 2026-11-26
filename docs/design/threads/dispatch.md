# Dispatch and the Threads board

## Summary

The Shuttle writes a task file and replies; the owner starts a Thread on it from the board with one click, and may start more than one. The Threads board on Today is derived from task files and run records, so it is live and costs no model call; a Thread's state is never stored, and the board's groups are set out in [Task status](states.md). Only the owner starts a Thread; they also edit, steer, answers, stops or drops from the board. A note, at most 100 words, reaches a Thread even while it runs, through one endpoint addressed by task; the owner or the Shuttle can send one, and it is recorded on the timeline first; see [Notes](notes.md). Part of the design in [the design index](../README.md).

## The flow

The Shuttle turns what the owner says into task files. It does not start Threads and never waits for one: a pick ends as soon as the files are written. The owner presses Start on the board, and from there the files carry the state.

[Diagram: Flow from owner through Shuttle and task files to Threads and back to the board; drawn in [the pictures](../pictures.html).]

*Figure: Solid arrows are writes and reads of files. The dashed line is the owner acting on the board directly; those actions change a task file or message a Thread and never pass through the Shuttle.*

## How a dispatch goes

1. **Write the task.** One task per deliverable, as a subtask when it belongs to a larger one. The task file is the brief; there is no second "assignment" object.
2. **Pick the kind of Thread from the task.** A task with a `repo` gets a coding Thread in a worktree; a task without one gets a document Thread that writes an artifact. Notes and links still go to ingest, which is an errand and not a Thread.
3. **Leave it for the owner to start.** The task sits as `todo` with a Start button on the board: the Shuttle proposes, the owner edits the task if they want, then starts it. This holds even when the owner asked for the work in the conversation: starting a Thread is the one thing that spends real money, so it takes the owner's own click (R7 in [The Shuttle's context and cache](../shuttle/context.md)). The server enforces it; no standing instruction can lift it.
4. **Reply and stop.** "Wrote T-012 to T-014; they are on the board for you to start." Links, no waiting.
5. **Code closes the loop.** Nothing is written to the task when a run ends badly: the task reads as blocked, waiting on human, derived from the run record ([Task status](states.md)), so an assigned `blocked` keeps its one meaning (set with a comment by the owner or by the agent itself). The hook that records what a run changed must fire on every finish, resumes included; today `sendMessage` resumes without it, so a resumed Thread's changes go unlogged.

The Shuttle is still not woken by a finishing Thread. The board already shows the result, and a wake-up is a paid pick that may land on a cold cache. Results reach the Shuttle in the envelope of the owner's next message, as today.

## The board

The Threads board leads Today and replaces the list of live runs; the Shuttle has its own page in the rail ([ADR 0019](../../adr/0019-shuttle-page-and-live-graph.md)). An empty group takes no space.

Groups, in order: **Waiting on human**, **Working**, **Ready**, **Waiting on task**; what each holds and its actions are in [Task status](states.md#the-board-is-a-view). A working task has one row per live Thread; any other task has one row. Each row shows the Thread mark in its state colour, the task id and title, a state tag, one line of detail (the question, or turns, time, context size and last action) and its actions. The Shuttle header above shows the bobbin's context against the budget and whether the cache is warm. Mock-up in [the pictures](../pictures.html), which still draws a "slow" state that is not in the first version.

The detail line needs figures while a Thread runs. Today a run's turns update only when its session stops and its cost and peak context only when it ends, so `runs.ts` must update turns and peak context as transcript lines arrive.

## A Thread's state is derived, never stored

The derived-state table that was here, and its notes on how it was built, are replaced by [Task status](states.md) ([ADR 0020](../../adr/0020-task-status-and-derived-blocked.md)): the task's status, what a blocked task waits on, and the Thread's own state, kept apart. No Thread record is stored; all three are a function of the task file, its timeline and its runs ([The graph](../graph.md)), which is what keeps a task from showing `in-progress` with nothing running.

A "slow" state for a Thread running past a turn or time threshold is left out of the first version; the detail line shows turns and time, and the Usage page shows what a long run cost.

## As built

Step 6 built the board in `board()` beside `talkToShuttle`, and the Shuttle's ledger is the same rows, one line per task. What still holds from it:

- **A question is answered** by the owner's note to the task or to the Thread that asked, written after it.
- **Actions:** Answer and Steer send a note; Send back sets `in-progress` and sends one; Continue sends the owner's note to carry on (resuming or starting the next Thread); Stop stops the run; Accept sets `done`; Drop moves the task to the trash; Start delegates with a one-line purpose, kept on the run record and shown on the Thread's card. Block and Unblock are in [Task status](states.md#as-built).
- **Errands** (ingest, ask, documents) are not Threads and no longer show on Today; the Shuttle reports them.

## Skills a Thread loads

Every Thread is started with `--plugin-dir plugins/thread`, a Claude Code plugin in the Loom checkout loaded for that session only. It adds to the skills of the repository and of the owner's own setup, and it holds one skill today, `loom-thread:pr`: the [mattpocock/skills](https://github.com/mattpocock/skills) `pr` skill, copied unchanged with its licence, so a Thread's pull request has the same Summary, Evidence and Merge Danger sections as the owner's. The brief names it by its full name, because a bare `pr` does not resolve to a plugin's skill. A Thread still opens a pull request only when the owner's extra instructions ask for one. A new skill goes in `plugins/thread/skills/`; each one adds its description to every Thread's fixed context. See [ADR 0025](../../adr/0025-skills-a-thread-loads.md).
