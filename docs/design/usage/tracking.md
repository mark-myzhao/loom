# Usage tracking

## Summary

Every run record carries what each start or resume of its session used: tokens by model in four classes, cost, and the largest context the session reached. The numbers come from the transcript Claude Code already writes, so nothing extra is asked of the model. The Usage page in the dashboard and `bun run usage` roll the same rows up by day, week, kind of run, task and model. The purpose is a daily or weekly retro: find what was expensive, see whether sessions start cold, and check each design rule against a number.

## What is recorded

`RunMeta.usage` is a list with one entry per start or resume of the session, per model:

| Field | Meaning |
| --- | --- |
| `at` | When that start or resume was sent. Usage is counted on this local day. |
| `model` | The model id. Sub-agents show up as their own models. |
| `input` | Prompt tokens not served from or written to cache. |
| `cacheWrite` | Prompt tokens written to cache: about 2× the price of input on Loom's one-hour tier. |
| `cacheRead` | Prompt tokens served from cache: about 0.1×. |
| `output` | Output tokens, thinking included. |
| `costUsd` | What Claude Code reports at list price. |

`RunMeta.peakContext` is the largest prompt the main session sent, in tokens. It is the number the bobbin budget (R2 in [shuttle/context.md](../shuttle/context.md)) is set against. `RunMeta.costUsd` is the sum of the entries. `RunMeta.turns` counts the model calls of the main session, sub-agents excluded. Both `turns` and `peakContext` are updated as transcript lines arrive, so a running run shows them live; usage and cost appear when the session stops. (Before this, `turns` summed Claude Code's `num_turns`, which counted T-009 as 94 for 59 calls.)

## How it is computed

One function, `account` in `server/runs.ts`, reads a run's transcript when the run ends.

Claude Code prints a `result` line when a session stops, and its `modelUsage` and `total_cost_usd` are totals for the whole session, earlier resumes included. So an entry is the last total before the next message minus the total before it. Loom used to add `total_cost_usd` on every result line, which counted earlier work again: T-001 showed $72.34 and cost $10.33; T-009 showed $16.64 and cost $10.77.

Records written before tracking existed are filled in from their transcripts when the server starts, once. A session that was killed before printing a result line has no usage entry for that stretch. Not verified: whether Claude Code then folds those tokens into the totals of the next resume, in which case they appear on the later entry.

## Reading it

| Surface | Use |
| --- | --- |
| Usage page (`#/usage`) | Charts first. Tiles for cost, prompt tokens, share served from cache and output. Bars over time, stacked by kind, by model or by token class. Bar lists by kind, task and model. A dot per run plotting peak context against cost, with the 100K mark the deferred budget would use; both figures are over the run's whole life, whatever range is selected. The costliest runs as bars of what they sent: cache reads, cache writes, fresh input. Clicking a bar or a row narrows every chart to it; clicking a run opens its transcript. Hovering shows the figures, and "The numbers" at the foot holds the same data as tables. Ranges: 7 days, 30 days, all; by day or week. |
| `bun run usage [days]` | The same tables as markdown. Default 7 days; `0` for everything. Reads the run files, so it works with the server down. A saved automation of kind `command` can run it daily. |
| `GET /api/usage` | The rows themselves: one per start or resume per model, with run, kind, title, project and task. |

## What to look for in a retro

| Signal | Reads as | Design rule it tests |
| --- | --- | --- |
| "Served from cache" low for a kind of run | Sessions start cold or the prefix changes between turns | R2, R4 |
| Cache writes large against prompt tokens | Many cold starts, or big documents read once | R2, T1 |
| Peak context far above 100K | A session that should have been split; the evidence for or against adding a budget | R2, T5 |
| One task dominating cost | A Thread reading too much, or a task that is too big | T1, T6 |
| A cheap model with a low cached share | Sub-agents that never reuse a prefix: usually fine, worth a look if their cost grows | none |
| Cost per Shuttle run after step 2 of the [roadmap](../roadmap.md) | Whether swapping bobbins paid off | R2, R3 |

## Left out

- **Per-turn and per-tool breakdowns.** The transcript has them; nothing yet needs them every day. Open the run from the Usage page when one run needs explaining.
- **Budgets and alerts.** A number to act on first; a rule later, if the retro keeps finding the same thing.
- **Sessions outside Loom.** Claude Code sessions the owner starts in a terminal are not runs and are not counted.
