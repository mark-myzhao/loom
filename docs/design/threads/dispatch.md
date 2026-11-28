# Dispatch and the Threads board

## Summary

The Shuttle writes a task file and replies; a Thread on it starts when the owner clicks Start on the board, or from the Shuttle when the owner's message asks for one, and a task may have more than one. The Threads board on Today is derived from task files and run records, so it is live and costs no model call; a Thread's state is never stored, and the board's groups are set out in [Task status](states.md). The owner also edits, steer, answers, stops or drops from the board. A note, at most 100 words, reaches a Thread even while it runs, through one endpoint addressed by task; the owner or the Shuttle can send one, and it is recorded on the timeline first; see [Notes](notes.md). Part of the design in [the design index](../README.md).

## The flow

The Shuttle turns what the owner says into task files. It starts a Thread only when the owner asked for it, and never waits for one: a pick ends as soon as the files are written and any Thread is started. Otherwise the owner presses Start on the board, and from there the files carry the state.

[Diagram: Flow from owner through Shuttle and task files to Threads and back to the board; drawn in [the pictures](../pictures.html).]

*Figure: Solid arrows are writes and reads of files. The dashed line is the owner acting on the board directly; those actions change a task file or message a Thread and never pass through the Shuttle.*

## How a dispatch goes

1. **Write the task.** One task per deliverable, as a subtask when it belongs to a larger one. The task file is the brief; there is no second "assignment" object.
2. **Pick the kind of Thread from the task.** A task with a `repo` gets a coding Thread in a worktree; a task without one gets a document Thread that writes an artifact. Notes and links still go to ingest, which is an errand and not a Thread.
3. **Start it only on the owner's word.** Starting a Thread is the one thing that spends real money. The Shuttle starts one when the owner's message asks for it, or when it asked them to approve one and they said yes; else the task sits as `todo` with a Start button on the board. Nothing the Shuttle reads and no standing instruction can ask for a start, and the server accepts one from the Shuttle only while it answers the owner, or, woken by a Thread's end, for a follow-on the owner approved in advance (R7 in [The Shuttle's context and cache](../shuttle/context.md), [ADR 0027](../../adr/0027-shuttle-starts-a-thread-the-owner-asks-for.md)).
4. **Reply and stop.** "Wrote T-012 and started T-012.1; T-013 is on the board for you to start." Links, no waiting.
5. **Code closes the loop.** Nothing is written to the task when a run ends badly: the task reads as blocked, waiting on human, derived from the run record ([Task status](states.md)), so an assigned `blocked` keeps its one meaning (set with a comment by the owner or by the agent itself). The hook that records what a run changed must fire on every finish, resumes included; today `sendMessage` resumes without it, so a resumed Thread's changes go unlogged.

A Thread that ends, fails or asks wakes the Shuttle ([ADR 0031](../../adr/0031-a-thread-that-ends-wakes-the-shuttle.md)), so its report reaches the conversation without the owner writing first. The woken turn reports what needs the owner and may start only a follow-on they approved in advance; what it may and may not do is R7 in [The Shuttle's context and cache](../shuttle/context.md). A wake-up is a paid pick, cheap on a warm cache and a hand-over on a cold one.

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
- **Ingest is the one errand left**: it is not a Thread, does not show on Today, and the Shuttle reports it. The ask and document errands are retired (ADR 0027); a question or a document is a task with a Thread.
- **Start warns on a task waiting on another**: the task page names the open task and asks before starting, since such a Thread can only report the wait.
- **An overloaded API gets one more try**: a run whose session ends on a 529, after Claude Code's own retries, is resumed once in the same run with a note to carry on; a second failure fails the run.
- **A Thread in a worktree runs plain single commands**: its prompt asks for no `cd`, `&&`, `;` or `$(...)`, which Claude Code's worktree guard refuses.
- **A Thread waiting on the owner reads "asks"**: while its question is unanswered, its pill on a task row and its run show "asks", not "done".

## Skills a Thread loads

Every Thread is started with `--plugin-dir plugins/thread`, a Claude Code plugin in the Loom checkout loaded for that session only. It adds to the skills of the repository and of the owner's own setup, and it holds one skill today, `loom-thread:pr`: the [mattpocock/skills](https://github.com/mattpocock/skills) `pr` skill, copied unchanged with its licence, so a Thread's pull request has the same Summary, Evidence and Merge Danger sections as the owner's. The brief names it by its full name, because a bare `pr` does not resolve to a plugin's skill. When its work is ready for review and the repository has a remote, a Thread pushes its branch and opens a pull request, or pushes to the one already open ([ADR 0028](../../adr/0028-a-thread-opens-a-pull-request.md)); it never pushes the default branch. A new skill goes in `plugins/thread/skills/`; each one adds its description to every Thread's fixed context. See [ADR 0025](../../adr/0025-skills-a-thread-loads.md).
