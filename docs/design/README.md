# Loom design

## Summary

Loom becomes a super-agent: the owner talks to one resident agent, the Shuttle, which routes work to Threads on tasks. A Shuttle session is disposable and starts fresh from files; a Thread reads an index before any document; the board is derived from files; notes reach a running Thread. Token usage is recorded per run so each of these claims can be checked. It was reviewed and amended on 2026-11-23 (ADRs 0011 to 0015). On 2026-11-24 it became one graph derived from files, where a project is a task and a task may have several Threads (ADRs 0016 to 0018).

Designs live here, one subject per file. Decisions live in [`../adr`](../adr/README.md), one per file; a design page explains how something works, an ADR records that it was chosen and why.

## Map

| Area | Page | Holds |
| --- | --- | --- |
| Start | [glossary.md](glossary.md) | The five words (Loom, Shuttle, Thread, Bobbin, Pick) and the plain words that stay |
| | [roadmap.md](roadmap.md) | Build order, what is built, open questions |
| | [graph.md](graph.md) | Nodes and their attributes, edges and `[[links]]` derived from files; `GRAPH.md`; how a Thread and the Shuttle walk it |
| | [graph.svg](graph.svg) | For people: the graph drawn, with each node's attributes |
| | [pictures.html](pictures.html) | For people: the diagrams, the board mock-up and the marks at size |
| Shuttle | [shuttle/context.md](shuttle/context.md) | Rules R1 to R7 for the Shuttle's context, prompt cache and permissions, with the measurements |
| | [shuttle/prior-art.md](shuttle/prior-art.md) | Where the rules come from, ideas left out, what three other systems publish |
| Threads | [threads/context.md](threads/context.md) | Rules T1 to T7 for what a Thread reads; document size limits; markdown as the source, HTML only for visuals |
| | [threads/dispatch.md](threads/dispatch.md) | Dispatch and the Threads board; the skills a Thread loads |
| | [threads/states.md](threads/states.md) | Task status; blocked assigned with a comment or derived; waiting on a human or a task; Thread state; the board as a view |
| | [threads/notes.md](threads/notes.md) | Notes to a running Thread; the owner's controls over work in flight |
| Usage | [usage/tracking.md](usage/tracking.md) | How token usage is recorded, the Usage page, the retro report |
| | [usage/telemetry.md](usage/telemetry.md) | Owner and agent actions logged locally: views, clicks, API writes, runs; the telemetry report |
| Brand | [brand/marks.md](brand/marks.md) | The Shuttle and Thread marks, with SVG source |
| Research | [research/superagent-lessons.md](research/superagent-lessons.md) | The DeepSeek super-agent study this design builds on |

## Rules for these pages

They are the rules of [threads/context.md](threads/context.md) (T6), applied to this folder, because agents work from these pages too.

- A page opens with a `## Summary` of at most 120 words that stands on its own.
- A section is at most about 1,500 tokens; a page at most about 8,000. Past that, split by subject.
- Facts live in markdown. HTML only for pictures, which hold no fact a markdown page lacks.
- A new area gets a folder; a page that does not fit an area goes at this level.
- When a design changes because of a decision, add an ADR and update the page in the same change. Pages describe the design as it stands; ADRs are the history.
