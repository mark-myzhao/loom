# Telemetry

## Summary

Loom appends one JSON line per owner or agent action to `telemetry/<day>.jsonl` in the data directory: pages viewed, buttons clicked, API writes with who made them, and runs started and ended. The folder is listed in the data directory's `.gitignore`, so it never enters the snapshot history or its remote; the app repository already ignores the data directory. Nothing leaves the machine and no text the owner or an agent wrote is copied, only its length. The Usage page and `bun run telemetry` roll the lines up for the same retro as token usage: which surfaces are used, what the owner does by hand that the Shuttle could do, and how long finished work waits for review.

## What is recorded

One file per local day, `telemetry/2026-11-25.jsonl`, one event per line. Every event has:

| Field | Meaning |
| --- | --- |
| `t` | ISO time the event happened. |
| `src` | `web` (the dashboard) or `server`. |
| `ev` | The event name, below. |
| `tab` | Web only: a random id per page load, so a visit can be followed in order. |

| `ev` | Recorded by | Extra fields |
| --- | --- | --- |
| `view` | Web, on every route change | `route` (the hash with ids kept, e.g. `#/p/loom/T-012`), `from`, `ms` spent on `from` |
| `click` | Web, one listener on `document` for buttons and links | `route`, `label`: the element's `data-track`; for a link, the kind of page it opens (`link task`); else `aria-label`, `title` or its text, cut to 40 characters |
| `api` | Server, in `fetch`, for every request that is not a `GET` | `method`, `path` (ids kept, query dropped), `status`, `ms`, `actor` (`owner` when the owner token matched, else `agent`), `len` (body length in characters) |
| `run.start` | Server, `runStarted` | `run`, `kind`, `project`, `taskId` |
| `run.end` | Server, `runFinished` | `run`, `kind`, `project`, `taskId`, `status` (`done`, `failed`, `stopped`, `interrupted`), `turns`, `costUsd`, `peakContext`. A run's length is read off its last `run.start`. |

Comments, notes, status changes, Starts and Steers are all `api` events: the path names the action and `actor` says whether the owner or the Shuttle did it. Their words stay in the task's timeline, where they already are.

## How it is written

One function, `track(ev, fields)` in `server/telemetry.ts`, appends a line with `appendFile` on a single promise chain, the way `runs.ts` writes transcripts. A failed write is dropped and logged once; telemetry never fails a request.

The dashboard runs `startTelemetry` in `web/lib.ts` once, which queues events and sends them to `POST /api/telemetry` every 5 seconds and on `pagehide` with `navigator.sendBeacon`. The server writes them with `src: web` and its own clock for the file's day. That route is not itself recorded as an `api` event, and it is not on the Shuttle's allow-list.

Clicks need no call per button: the one listener names an element from what it already carries. A button whose text is data, such as a run's title, gets a `data-track` naming its role (`run`, `graph node`), so the label is UI copy and not content. The roll-ups (`pageOf`, `actionOf`, `countBy`, `runSpans`, `reviewWaits`) are in `server/usage.ts`, shared by the page and the report.

`config.telemetry` is `true` by default; `false` stops every write, web and server. `initStorage` adds `telemetry/` to the data directory's `.gitignore`.

## Reading it

| Surface | Use |
| --- | --- |
| Usage page (`#/usage`), Activity | Below the token charts, in the same range and days or weeks. Tiles for page views, clicks, the owner's share of writes and the median wait for review. Bars over time stacked by views, clicks, owner writes, agent writes and runs; clicking one narrows the whole page to that day. Rows for pages viewed with median time on page, the most clicked labels, writes by action split owner and agent, and runs by kind and status with median length. |
| `GET /api/telemetry` | Every event, oldest first. |
| `bun run telemetry [days]` | Markdown tables, default 7 days, `0` for everything. Reads the files, so it works with the server down, and a `command` automation can run it weekly. |
| The files | `jq` or DuckDB over `telemetry/*.jsonl` for anything the report lacks. `run` joins an event to its record in `runs/`. |

The report has five tables: views by route with median time on page; the 20 most clicked labels; `api` events by path and actor; runs by kind and status with median duration; and the wait from a Thread's `run.end` to the owner's next `api` event on the same task.

## What to look for in a retro

| Signal | Reads as | Acts on |
| --- | --- | --- |
| A route nobody opens in two weeks | A surface that can be cut or merged | The dashboard |
| The owner writing a status, note or task by hand far more often than the Shuttle does | Routing the Shuttle should do | Shuttle prompt, [shuttle/context.md](../shuttle/context.md) |
| Long wait from a Thread's end to the owner's review | The board does not surface finished work | [threads/states.md](../threads/states.md) |
| Many Steers or Send backs per Thread | Briefs that start Threads in the wrong place | [threads/context.md](../threads/context.md) |
| A kind of run that often ends failed or stopped | A prompt or permission that does not fit the work | `prompts.ts`, the allow-list |
| The same click repeated within seconds | A control that did not respond visibly | The dashboard |

## Left out

- **Text the owner or an agent wrote.** The task files hold it; copying it here would make a second, ungoverned copy.
- **Sending anywhere.** Telemetry is for the owner's own retro; there is no upload and no remote.
- **What a Thread does inside its session.** Tool calls and turns are in the run transcript; `run.end` carries the totals.
- **Mouse movement, scroll and keystrokes.** Noise for the questions above.
- **Retention.** A day's file is a few kilobytes; delete old files by hand if they ever matter.
