# Roadmap

## Summary

Nine steps build the Shuttle and Threads design, each useful alone and small enough for one Thread, except step 3, which is two. Usage tracking is built and is the instrument for judging the rest. The order was changed after the design review: the stashed Shuttle lands first, notes come before the board that uses them, and the context-budget swap, the "slow" state and artifact tabs are left out of the first version.

## Built

| What | Where |
| --- | --- |
| Usage tracking: per-run token records, the Usage page, `bun run usage` | [usage/tracking.md](usage/tracking.md) |
| Step 1: the clock in each message, write-through and "three reads" lines, links and the `shuttle` author, the allow-list | [shuttle/context.md](shuttle/context.md) R1 R4 R5 R7 |
| Step 2: the ledger, the hand-over envelope, a fresh session when the cache is cold, `SESSIONS.md`, context and warm or cold in the Shuttle header | [shuttle/context.md](shuttle/context.md) R2 R3 |

## Build order

| # | Step | Rules | Touches |
| --- | --- | --- | --- |
| 0 | Land the first version of the Shuttle from the git stash on `main`, with usage tracking. | | stash, `main` |
| 1 | Move the clock out of the Shuttle's system prompt into each message; add the write-through and "three reads" lines; replace `/api/*` and data-wide writes with the allow-list, without the delegate route; drop `/api/state` from its routes. | R1 R4 R5 R7 | `prompts.ts`, `index.ts` |
| 2 | Ledger function (capped); envelope with ledger and last three exchanges; start a fresh bobbin when the cache is cold; show context size and warm or cold in the Shuttle header. | R2 R3 | `index.ts`, `Today.tsx` |
| 3 | In two parts. The graph: `[[links]]`, one function for nodes and edges, generated `GRAPH.md`. Then the task's neighbourhood (its Threads, artifact outlines with line ranges, the memory index) in the Thread brief. | T1 T2, [graph](graph.md) | `store.ts`, `prompts.ts`, `conventions.md` |
| 4 | Size rules and the Over length mark for artifacts; markdown renderings of HTML artifacts. | T6 T7 | `conventions.md`, `store.ts`, `prompts.ts` |
| 5 | Notes: sessions take input while running; one `/note` endpoint by task where the server sets the author from the owner's token, which the delegate route then also requires; only the owner's note resumes a Thread or starts the next one; a note reaches every running Thread of the task, or one by address; timeline events carry the Thread's address and a finish lists what it changed; notes are re-sent after the last result; the completion hook fires on every finish. | R6 T5 | `runs.ts`, `index.ts`, `TaskPage.tsx` |
| 6 | `question` event on the timeline; live turns and context on a running run; Threads board, a row per Thread, with derived states, replacing the live-runs list. Answer, Steer and Send back use step 5. | T4, board | `runs.ts`, `store.ts`, `conventions.md`, `Today.tsx` |
| 7 | Marks in the UI; "Thread" replaces "coding agent" in copy and prompts. | names | `ui.tsx`, copy |
| 8 | A project becomes the task `T-000`; sources and repos become artifact files; `project.json` goes. One-time migration; the project page is the task page. | [graph](graph.md) | `store.ts`, `conventions.md`, `web/` |

After step 2, two numbers say whether the Shuttle rules worked: the share of Shuttle input tokens served from cache, and Shuttle cost per owner message. After step 3, compare a Thread's peak context with T-009's 274K. Both are on the Usage page.

## Left out of the first version

Decided after the review, in [ADR 0014](../adr/0014-first-version-scope.md): swapping a warm bobbin at a context budget, the "slow" Thread state, the note sent when a task with a live Thread is edited, and artifact tabs on the task page.

## Open questions

1. **Is a context budget needed at all?** 100K was the guess for when to swap a warm bobbin. Look at peak context for Shuttle runs after a week of step 2; add the swap only if warm bobbins grow past what compaction handles well.
2. **How much lighter can the Shuttle's fixed prefix get?** Unmeasured. If `--strict-mcp-config` and a `--tools` list cut 32K to under 15K, every cold start and every warm pick gets proportionally cheaper. A two-turn test run, read off the Usage page, answers it.
3. **Does Claude Code put the date in its own system prefix?** If so the cache breaks daily whatever Loom sends. The first cold-start figures after step 1 show it.
4. **Are a killed session's tokens lost or folded into the next resume?** Affects only how the usage record reads after a crash.

Settled on 2026-11-24: one graph derived from files, several Threads on a task, and a project as a task (ADRs [0016](../adr/0016-one-graph-derived-from-files.md) to 0018).

Settled on 2026-11-23 and recorded as decisions: a finishing Thread does not wake the Shuttle ([ADR 0006](../adr/0006-board-derived-from-files.md)); a new bobbin carries three exchanges verbatim ([ADR 0003](../adr/0003-code-writes-the-hand-over.md)).
