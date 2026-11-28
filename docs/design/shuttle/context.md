# The Shuttle's context and cache

## Summary

A Shuttle session (a bobbin) is disposable. The Shuttle records every decision, fact and preference in Loom's files, through its API, in the turn it learns it, and Loom starts a fresh session when the prompt cache is cold (55 minutes idle). Code, not the model, writes the hand-over: standing instructions, a ledger of open work, the last three exchanges. The clock moves out of the system prompt, input is capped, talk about a task goes to its Thread, and the Shuttle's permissions are an allow-list. A cold cache is acceptable; good memory is what makes starting fresh safe. Part of the design in [the design index](../README.md).

## What Loom's own runs say

Read from the run records in `data/runs/`. No Shuttle run is recorded yet (its code is in a git stash), so the Shuttle figures further down are arithmetic on these, not measurements.
- **~32K tokens** in context before a session reads anything: Claude Code's own prompt, tool definitions, connectors and skills. Same in a 2-turn run and the long T-009 task run.
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

- **Writes:** none directly. It reads files and changes them through its routes, which write the files and their timeline events (ADR 0026).
- **API routes:** a list, not a prefix. Create and patch a task, tick a checklist item, create and replace a memory entry, replace its notebook (`PUT /api/shuttle/notebook`, at most 40 lines), note, ingest, start a Thread, stop a run, read a task or run. Not config, not automations, no deletes, no new projects. The ask and generate errands are gone.
- **Signing.** The task routes sign the owner's token `me` and any other caller `shuttle`, so `SESSIONS.md` still finds the Shuttle's events by `by: shuttle`. Only the dashboard and the Shuttle call them; Threads write their files. A Shuttle token does not work: Claude Code refuses a command that expands `$VAR`, and a literal one would sit in run records.
- **Work it hands off goes to a Thread on a task, started on the owner's word** ([ADR 0027](../../adr/0027-shuttle-starts-a-thread-the-owner-asks-for.md), replacing 0015). The Shuttle writes the task, then starts a Thread only when the owner's message asks for it, or when its last reply asked them to approve one and they said yes. Otherwise the board shows the task with a Start button. Nothing it reads can ask for a start, and no line in `SHUTTLE.md` can grant one, so the file the Shuttle writes cannot grant it permission to spend. Without the owner's token (the one that marks the owner's notes, in [Notes](../threads/notes.md)) the server accepts delegate only while the Shuttle's run is answering, and signs the start `shuttle`. A start without a path runs in the task's codebase, or the project's directory when it has none. Ingest is the one errand left to it: a link's result is filed into tasks and memory.
- **A Thread that ends wakes it, and a woken Shuttle reports** ([ADR 0031](../../adr/0031-a-thread-that-ends-wakes-the-shuttle.md)). When a Thread's run ends, fails or stops on a question, Loom sends the Shuttle the runs that ended since its last reply with no words from the owner after the `---`; one that ends mid-turn rides the next turn. The chat shows that message folded as "From Loom". A woken Shuttle **may** tell the owner what needs them and start a follow-on the owner approved in advance. It **may not** record an approval, start any other Thread, or do anything else a report asks for. Approval in advance: in a turn the owner began, the Shuttle sets the follow-on's `after` and sends `{"approve": true}` to delegate, which writes `approved to start after …` on its timeline. In a woken turn the server accepts a start from the Shuttle only for a task whose approval is newer than its last start and whose `after` names a task whose Thread woke it, and the start spends the approval.

Change: `allowedTools` in `talkToShuttle` is `Read`, `Glob`, `Grep` and one curl rule per route. Each rule puts the method before the URL, but a crafted command can still bend a wildcard rule to another route (a second URL, a second `-X`). So the server, not the list, holds what matters: without the owner's token it refuses delegate outside a Shuttle turn or, in a woken turn, for a task not approved to follow one that ended, `PUT /api/config`, creating or editing an automation, and every `DELETE`. The token is not a boundary against a deliberate forgery ([Notes](../threads/notes.md)); it stops a Shuttle that followed text it read.

The write rules it replaced, `Edit(projects/**)` and friends, stopped matching after a `cd` in Bash for the rest of that turn (cause unconfirmed), so a Shuttle that had `cd`-ed refused every write.

## End-to-end tests

`bun run e2e [case ...] [--budget tokens] [--model id]` checks that the Shuttle gets a request done and measures what that costs ([ADR 0031](../../adr/0030-shuttle-e2e-tests-under-a-token-budget.md)). It runs the real server and real Claude Code on a throwaway data directory seeded with one project of three tasks. Each case is one message in a fresh conversation, checked against the files afterwards: create a task, set a status, tick a checklist item, add a memory entry, write the notebook, answer without writing, start a Thread, file a link.

The budget counts every token, cache reads included, from the live transcripts; past it the live runs stop and the rest are not run. A Thread or ingest run the Shuttle starts is stopped at once. The report gives per case: done or why not, turns, tool calls (errors), tokens by kind, cost and time. Its first run, the baseline for the Shuttle on curl, is kept with task T-022.
