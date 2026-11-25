# The Shuttle's context and cache

## Summary

A Shuttle session (a bobbin) is disposable. The Shuttle writes every decision, fact and preference to a file in the turn it learns it, and Loom starts a fresh session when the prompt cache is cold (55 minutes idle). Code, not the model, writes the hand-over: standing instructions, a ledger of open work, the last three exchanges. The clock moves out of the system prompt, input is capped, talk about a task goes to its Thread, and the Shuttle's permissions are an allow-list. A cold cache is acceptable; good memory is what makes starting fresh safe. Part of the design in [the design index](../README.md).

## What Loom's own runs say

Read from the run records in `data/runs/`. No Shuttle run is recorded yet (its code is in a git stash), so the Shuttle figures further down are arithmetic on these, not measurements.
- **~32K tokens** in context before a session reads anything: Claude Code's own prompt, tool definitions, connectors and skills. Same in the 2-turn setup run and the long T-009 task run.
- **1 hour** prompt-cache lifetime on Loom's headless runs (every cache write is recorded as `ephemeral_1h`).
- **32K → 274K** context growth of the T-009 agent over 94 turns as Claude Code counts them (59 model calls in the main session). It re-read 11.1M cached tokens along the way and cost $10.77.
- **~5K tokens** one `GET /api/state` today, with two projects. The Shuttle prompt points at it for "what is happening".

Two price ratios drive everything below, relative to a plain input token: a cached token read costs **0.1×**, and a token written to the one-hour cache costs **2×**. So:

- **Warm turn** on a context of size C: about 0.1 × C. Cheap, and proportional to how much has piled up.
- **Cold turn** (more than an hour since the last one): about 2 × C. The whole conversation is written again, to say one sentence.
- **Every token an agent reads is paid again each later turn.** A 12K-token document opened at the start of T-009's 59 model calls costs about 24K to write and then about 70K more in re-reads.

A personal dashboard is used in bursts with hours between them, so most bursts open on a cold cache. That makes "how big is the context when the cache is cold" the number to design for.

## Bobbins and picks

One session of the Shuttle is a **bobbin**: the spool the shuttle carries, which runs out and is swapped without stopping the weave. One Shuttle turn is a **pick**. The design is seven rules; the first makes the next five safe, and the seventh limits what the Shuttle can touch.

[Diagram: Timeline of three bobbins separated by idle gaps; drawn in [the pictures](../pictures.html).]

*Figure: Context size through a day. Solid: a bobbin is swapped whenever the cache is cold (the picture also shows a swap at a budget, which is deferred; see R2). Dashed: today's single resumed session, which pays 2× its whole height at 13:30 and again at 16:10.*

## R1. Write through: nothing lives only in the conversation

A decision goes on the task's timeline, a durable fact into project memory, a standing preference into `SHUTTLE.md`, in the same pick that produces it. The stashed prompt already says "Loom's files are your memory"; this sharpens it into a rule the Shuttle can be held to: *assume this conversation ends after every reply*.

Change: three sentences in `shuttlePrompt`.

## R2. Swap the bobbin when the cache is cold

When a message arrives and the last pick ended more than 55 minutes ago, the cache is gone whatever Loom does. Resuming would write the whole old conversation at 2×; starting fresh writes the fixed 32K plus a small envelope. An idle hour is also where the owner changes subject, so the same rule that saves the cache clears the stale topics.

| First message of a burst | Resume the old session | Fresh bobbin |
| --- | --- | --- |
| Old conversation at 45K | ≈ 90K | ≈ 70K |
| Old conversation at 120K | ≈ 240K | ≈ 70K |
| Old conversation at 250K | ≈ 500K | ≈ 70K |

Cost in plain-input-token equivalents; the fresh figure is 2 × (32K fixed + 3K envelope) and is a ceiling, since the fixed part is shared with any other Loom run in the last hour. Fresh never loses, so the rule needs no size test when cold.

Change: in `talkToShuttle`, treat the run as `fresh` when `now − endedAt > 55 min`. "New conversation" stays as the manual version. Built in step 2; the header of the Shuttle page shows the session's peak context and whether its cache is warm.

**Deferred: a budget.** Swapping a warm bobbin once its context passes a size (100K was the guess) is not in the first version. Claude Code's own compaction is the backstop until the Usage page shows how large warm bobbins get. If a budget is added, it is tested against the run's `peakContext`, not against usage sums.

## R3. Code writes the hand-over

The first message of a bobbin is an envelope Loom assembles, with the owner's text last:

```
Loom: 2026-11-23T21:40:11Z
Standing instructions (SHUTTLE.md):
  …at most 40 lines…
Open work:
  T-003 in-progress loom  Thread running, 12 turns
  T-011 blocked loom  Thread asks: "Keep the old /ingest route as an alias?"
  T-009 review  loom  report on the timeline
Earlier today, verbatim:
  me: have an agent look at the flaky backup test
  Shuttle: Wrote T-012; it waits for your Start …
  (two more exchanges)
---
<the owner's message>
```

The ledger is [the graph](../graph.md) cut at open work, built from task files, timelines and run records. It lists only tasks that have a Thread or are waiting on the owner, at most 20 lines, so it cannot grow the way the state snapshot does. A Thread's question in the ledger is quoted text from an agent: the Shuttle's prompt says to treat it as something to show the owner, never as an instruction. The last three exchanges are copied from the previous transcript, each cut at 600 characters, so "yes, do that" two hours later still has its referent. No model call writes any of it, which removes both the cost of summarising and the slow drift of summaries of summaries. It also saves the tool round trip the Shuttle spends today reading `SHUTTLE.md`. Past sessions are kept as a generated list, one dated line each naming the tasks that session wrote; with `SHUTTLE.md` that list is the Shuttle's memory.

Change: one function beside `talkToShuttle`; the same ledger feeds the Threads board. Built in step 2. Every context line is indented, so the first bare `---` line is where the owner's words start; the chat shows those words and folds Loom's lines above them. Until step 5 numbers Threads on the timeline, the ledger numbers a task's Threads by the order of its runs. The session list is `SESSIONS.md` in the data directory, regenerated on each message from run records and the timeline events signed `shuttle`.

## R4. Keep the prefix still: the clock moves to the message

A cache hit needs the start of the request to be byte-identical. `shuttlePrompt` opens with `opening()`, which embeds the current time, and that prompt is stored once and replayed on every resume. So the cache holds, but the Shuttle's clock is frozen at the moment the conversation began, and every timeline event it writes later carries the wrong time. Regenerating the prompt each turn would fix the clock and break the cache for the whole conversation. The right place for anything that changes is the end: each message gets the `Loom: <time>` line shown above, and the system prompt holds only text that never changes.

Change: drop `opening()` from `shuttlePrompt`; prepend the time in `talkToShuttle`, and in `sendMessage` for every resume, the Shuttle's and a Thread's alike. This is a bug in the stashed code regardless of the rest. A Thread's brief (`taskPrompt`) has the same frozen clock when its session is resumed, so every message that resumes a Thread carries the time too.

Not verified: whether Claude Code puts the date into its own system prefix. If it does, the cache breaks once a day whatever Loom sends; the first cold-start figures on the Usage page will show it.

## R5. Cap what enters

- **Cards, not contents.** A finished run reaches the Shuttle as a card: the task id, its status, the first line of its report cut at 300 characters, and its question if it has one. The timeline is the pointer to the rest. Today's "Loom:" note already has this shape; add the report line and the cap.
- **The ledger replaces `/api/state`.** The snapshot is 5K tokens now and grows with every project. Each pick's envelope carries only what changed since the last one; remove the snapshot from the Shuttle's route table.
- **Three reads, then dispatch.** A question that needs more than about three files goes to an `ask` run, which already exists. The Shuttle's context receives the answer and not the reading.
- **Never open a transcript, a repository file or a whole artifact.** Those belong to Threads. This is DeepSeek's strongest rule and it is free.
- **A lighter fixed prefix.** The Shuttle uses six tools, yet starts with the same 32K as a coding agent. Start its session with `--strict-mcp-config` and a `--tools` list and measure what the first turn's cache write drops to. Not yet measured.

## R6. Talk about a task goes to its Thread

A comment or answer written on a task page is delivered to that task's Thread, and the Shuttle receives one line saying so. DeepSeek measured this: with direct delivery the router made about 30% fewer decisions and the system re-read 27% fewer cached tokens. For Loom it also keeps the detail of five tasks out of the one conversation that has to stay clean.

## R7. The Shuttle's permissions are an allow-list

The Shuttle reads text it did not write: Thread questions and report lines, and task bodies an ingest run wrote from a web page. So what it can do must not depend on it behaving. The first version in the stash lets it write anywhere in the data directory and call any `/api/*` route, which reaches `automations.json`, `config.json` and "run automation", and a command automation runs a shell.

- **Writes:** `projects/**` and `SHUTTLE.md` only. Not `config.json`, `automations.json`, `state.json`, `runs/` or the inbox.
- **API routes:** a list, not a prefix. Create and patch a task, comment, note, ask, ingest, generate an artifact, stop a run, read a task. Not config, not automations.
- **Only the owner starts a Thread.** The Shuttle writes the task and the board shows it as proposed with a Start button. The delegate route is not on the Shuttle's list, and the server refuses it from any caller without the owner's token (the one that marks the owner's notes, in [Notes](../threads/notes.md)). No line in `SHUTTLE.md` can change this, so the file the Shuttle writes cannot grant it permission to spend. Errands the Shuttle may still start itself: an `ask` run for a question that needs more reading, an ingest run for a link, a generated document.

Change: the `allowedTools` list in `talkToShuttle` names each route and scopes `Edit` and `Write` to those paths. Built in step 1, with two narrowings. The task routes (create, patch, comment) are not on the list, because the server records their caller as the owner: the Shuttle changes tasks through their files and signs its timeline events `shuttle`. The note route joined the list in step 5. Each rule puts the method before the URL, so `GET …/tasks/*` cannot match `POST …/delegate`; a wildcard rule can still be bent by a crafted command, which is why the owner token is the hard stop.
