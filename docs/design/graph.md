# The graph

## Summary

Decided in ADRs [0016](../adr/0016-one-graph-derived-from-files.md) to 0018; links, the graph and `GRAPH.md` are built (see "What is built"). Everything Loom holds is a node with attributes: the Shuttle and its past sessions, task (a project is the root task), Thread, artifact (a document, a link or a repository), section, memory entry. A task's timeline orders its edges. Several Threads may weave one task. Edges are derived from existing fields, the timeline and one link syntax, `[[…]]`. Loom generates a greppable `GRAPH.md` per project. A reader enters at one node, gets its neighbours as one-line cards and opens a body only by following an edge. The manifest, memory index and ledger become views of it. Drawn in [graph.svg](graph.svg). Part of the design in [the design index](README.md).

## Why a graph

The design already loads by pointer: the manifest (T1), the memory index (T2), cards (T4, R5), the ledger (R3). Each is a separate list built its own way, and each stops at a fixed boundary. Three gaps follow.

- **A pointer in prose is invisible.** T-003's Context says "start at `docs/design/README.md`". A Thread on T-006 gets no outline of that page, because the manifest lists only artifacts whose filename carries the task id. It must find the page and decide how much to read with nothing to go on.
- **Edges run one way.** An artifact names its task, a subtask names its parent. Nothing answers "what points at T-005": the tasks waiting on it, the note that mentions it, the decision it produced.
- **The Shuttle knows open work only.** The ledger lists tasks with a Thread or waiting on the owner. "What did we decide about notes, and which task did that" needs a search across files, paid for in the Shuttle's own context.

A graph closes all three with one idea and no stored state. It is the board's rule ([ADR 0006](../adr/0006-board-derived-from-files.md)) applied to context: derived from the files, never kept beside them.

## Nodes

A node is something that already has a file, a heading or a record. Its address is what a link names.

![The graph: each node with its stored and derived attributes, and the edges between them. Every fact in it is in this page.](graph.svg)

| Node | Address in a link | Card (one line) |
| --- | --- | --- |
| Shuttle | none; it is where the owner's conversation enters | open work as the ledger counts it |
| Shuttle session | `shuttle@2026-11-24T12:38` | when, the owner's first message cut at 100 characters, what it wrote |
| Task | `T-006`; `slug/` or `T-000` for a project, the root task | status, priority, title, how many Threads and what they need |
| Thread | `T-006.2` | purpose, state as the board derives it, turns |
| Artifact | by kind, below | title, kind, size in tokens, Over length mark |
| Section | `<artifact>#Must fix` | heading, line range, size |
| Memory entry | `shuttle-never-starts-threads` | the description, which is already the fact |

**An artifact is anything the work reads or produces**, and every artifact is a file in `artifacts/`. It has three kinds, told apart by `origin`. What was a "source" is a link; what was a registered codebase is a repository.

| Kind | `origin` | The body is | Address |
| --- | --- | --- | --- |
| document | `generated`, `imported`, `written` | the file itself, markdown or HTML | `t-003-design-review.md` |
| link | `link` | at the URL in `source`: a Google doc, a Slack thread, a GitHub issue or pull request, any page. The file holds the title and an optional note | `weekly-notes.md` |
| repository | `repo` | a codebase at the path in `source` | `loom.md`; a file inside it is `loom:docs/design/graph.md` |

- **A link has a card and no sections**, since its body is not local. An imported document with the same `source` is its copy.
- **A project is the root task, `T-000`** ([ADR 0018](../adr/0018-a-project-is-a-task.md)); see "A project is a task" below.
- **A Thread is one run of an agent on a task, and a task may have several.** Its address is the task id and its number in the order Threads started on that task. It is resumed while its cache is warm. Work picked up cold is the next Thread: it starts from the earlier one's report and, for code, in the same worktree and branch. A second Thread can also run beside the first, for a review or a second attempt. A different deliverable is still a subtask.
- **A past Shuttle session is a node, by its start time.** The Shuttle's memory is `SHUTTLE.md` plus these. A session keeps no summary: under R1 everything it learned is on the nodes it wrote, so its card is its date and its edges.
- A timeline event is not a node; it is an edge with a time. See "The task's timeline" below.
- `other-slug/T-004` reaches a node in another project.

## Node attributes

Each node has stored attributes, read from a file or a record, and derived ones, computed when a card is built and never written down. A card is made from these and nothing else.

| Node | Stored (where) | Derived |
| --- | --- | --- |
| Shuttle | standing instructions (`SHUTTLE.md`) | the current session's context size and whether its cache is warm; open work; its past sessions |
| Shuttle session | started, ended (run record) | the owner's first message; what it wrote; cost |
| Task | id, title, status, priority, due, parent, repo, created, updated; Context, Things to do, Exit criteria (`T-nnn.md`); its timeline (`T-nnn.log.md`) | checklist progress; its Threads and their states; needs you; linked from |
| … root task (project) | as any task (`tasks/T-000.md`); the slug (its directory) | open subtasks; Threads running; its memory entries |
| Thread | task, purpose, kind (coding or document), worktree and branch, who started it, started, ended (run record and the timeline's `run` events) | address; state; turns, peak context, cost; cache warm until; its report; its open question; which Thread it continues |
| Artifact, any kind | name, title, origin, task, source, created (frontmatter or `<meta>`) | kind; written by; linked from |
| … document | nothing more | size; sections; Over length; modified |
| … link | `source` is the URL | where it points (`gdoc`, `slack`, `github`, `url`), from the URL; its copies; what was read from it |
| … repository | `source` is the path | the files in it that are linked |
| Section | heading (the document) | line range; size |
| Memory entry | name, description, type, source, updated, body (`memory/<name>.md`) | Over length; linked from; written by |

- **One attribute is new: a Thread's purpose**, the line the owner gives at Start, at most 30 words. Today it is the delegate call's `instructions`.
- **A Thread's address is derived**, from the order of `run` events on the task's timeline, so nothing has to carry it across sessions.
- **A Thread's state is derived as the board derives it** ([Dispatch](threads/dispatch.md)), per Thread and no longer per task. A task's card then counts them: "2 Threads: one ended, one running".
- **A Thread's question is a `question` event on the timeline**, authored by the Thread and cleared by the owner's note to it, so two Threads of one task can each ask and "asks" stays derived.
- **A timeline event's author becomes an address:** a Thread's where it is `agent` today, and `shuttle` for the Shuttle, which writes as `claude` today. That is what lets "written by" be derived.

## Edges

| Edge | From → to | Derived from |
| --- | --- | --- |
| part of | task → task | `parent`; with none, `T-000` of its directory |
| in | task → repository | `repo`, naming the repository artifact |
| known to | memory entry → root task | the directory it is in |
| documents | artifact → task | `task` in the artifact's metadata; with none, `T-000` |
| copy of | document → link | the same `source` on an imported document and a link |
| read from | memory entry → link | `source` on the entry, naming the link |
| weaves | Thread → task | the `run` event on the task's timeline, written today |
| continues | Thread → an earlier Thread of the task | it was started from that Thread's report |
| wrote | Thread or Shuttle session → task, artifact, memory entry | the timeline: events they authored, and the record of what a finished Thread changed |
| mentions | anything → anything | a `[[…]]` link in a task body, a timeline entry, an artifact or a memory entry |

- **Artifacts connect to each other** by "mentions" (a design page linking a review, a report linking a pull request) and by "copy of". No separate mechanism: a link in a document is an edge like any other.
- **One link syntax.** Memory entries already link each other as `[[entry-name]]`. The same brackets now take any address above, in any file. The target's shape says what it is: `T-` and digits is a task, with `.n` a Thread; a name with an extension is an artifact; `name:` and a path is a file in a repository; anything else is a memory entry. A bare task id in prose (`T-005`) counts without brackets, since its shape is unambiguous.
- **A section is matched by the start of its heading**, so `#T1` finds "T1. The brief carries a manifest" and survives the heading being reworded after the number.
- **Mentions are untyped.** The sentence around the link says what the relation is ("waits on [[T-005]]"), and the edge carries that line cut at 100 characters. A typed edge is a field someone has to keep right.
- **An edge adds context, never authority.** A Thread that follows a link to another task may read it and may not change it.
- **Every edge is read both ways.** The backward direction is the part no single file can give.
- **A link that resolves to nothing** is listed as `missing` and fixed when the file is next touched.

## A project is a task

A project was a second kind of thing with its own file, status words and page. It becomes the task at the top of its directory, and `project.json` goes.

| Was, in `project.json` | Becomes |
| --- | --- |
| `name` | `title` of `tasks/T-000.md` |
| `status`: `active`, `paused`, `done` | `status`: `doing`, `todo`, `done` |
| `summary` | `## Context`, at most about 120 words |
| `createdAt`, `updatedAt` | `created`, `updated` |
| each of `repos` | an artifact with `origin: repo`, named for the repo (`loom.md`) |
| each of `sources` | an artifact with `origin: link`, named by its old id (`k3x9ab.md`) so memory entries that cite it still resolve; new links get readable names |
| nothing | `## Things to do`, `## Exit criteria`: what the project is for and when it is finished |
| nothing | a timeline, `T-000.log.md` |

- **`T-000` is free in every project today**, since ids start at `T-001`. A task with no `parent` is part of it; nothing has to be written on the task.
- **What a project gains:** a timeline of its own, exit criteria, and the same page, card and brief as any task. A Thread can weave it ("plan this project"), started by the owner like any other.
- **What stays with the directory:** the slug, the id numbering, the memory entries and the artifacts. A project is now three folders: `tasks/`, `memory/`, `artifacts/`.
- **One thing is lost:** `paused` and "not started" are both `todo`. The owner accepted this.
- **Projects do not nest inside projects.** One root per directory; a larger effort is a deeper task tree.

Change: a one-time migration that writes `T-000.md` and the artifact files from each `project.json` and removes it; `store.ts` reads a project from them; the project page becomes the task page of `T-000`; the conventions lose the project format and its status words.

## The task's timeline

A task's timeline is every edge that touches the task, in order of time. It is the one place that ties together the Threads that worked on a task and the artifacts that came out of it.

```
T-006
12:40  shuttle@…12:38  wrote      T-006                 from "have an agent build the manifest…"
13:02  T-006.1         weaves     started by the owner  "build the manifest"
13:41  T-006.1         report     review                "Outlines print; 3 tests added"
13:41  T-006.1         wrote      t-006-manifest-notes.md, brief-is-a-neighbourhood
15:10  T-006.2         continues  T-006.1               "finish and open the pull request"
16:05  T-006.2         wrote      t-006-pull-request.md
```

- **Most of this is written today.** `T-nnn.log.md` already holds `created`, `status`, `comment` and `run` events, with a `run` event at each start and finish.
- **Two things are missing.** An event's author is `agent` or `claude` and not an address; and a finished Thread leaves no list of what it changed. The completion hook in roadmap step 5 already has to record that list.
- **So the timeline is the source for "weaves", "continues" and "wrote".** No run record gains a field for the graph, and the page the owner reads is the same record the edges come from.
- **The brief gives a new Thread the reports of the earlier ones** as cards (T4), which is the hand-over from one Thread to the next. It reads a full report only if it needs it.

## GRAPH.md

`projects/<slug>/GRAPH.md` is generated whenever a file in the project changes; the server already watches the directory and already regenerates `MEMORY.md` this way. Never edited by hand or by an agent.

```
## Nodes
T-003  doing  p2  "Build the Shuttle and Threads design"  no Thread
T-006  doing  p2  "Manifest and memory index in the Thread brief"  2 Threads: 1 ended, 1 running
T-006.1  "build the manifest"  ended  41 turns  report "Outlines print; 3 tests added"
T-006.2  "finish and open the pull request"  running
t-003-design-review.md  document  "Design review of the Shuttle and Threads design"  ~1.3K tokens
loom:docs/design/threads/context.md  file in loom.md  "What a Thread reads"  ~2.4K tokens
loom.md  repository  "loom"
k3x9ab.md  link gdoc  "Weekly notes"
t-006-pull-request.md  link github  "Print document outlines in the Thread brief"

## Edges
T-006 | part of | T-003
T-006.1 | weaves | T-006 | 2026-11-24 13:02
T-006.2 | continues | T-006.1 | 2026-11-24 15:10
T-006.2 | wrote | t-006-pull-request.md | 2026-11-24 16:05
t-003-design-review.md | documents | T-003
t-003-design-review.md | mentions | loom:docs/design/threads/context.md#T5 | "T5 is stated two ways"
T-006 | mentions | loom:docs/design/threads/context.md#T1 | "Print the outline as [[…#T1]] describes"
```

- **One line per node and one per edge, with the address spelled the same everywhere.** `Grep "T-006" GRAPH.md` returns T-006's card and every edge that touches it, in either direction, without loading the file. That is the whole query interface.
- **A file, not an endpoint**, for the reason T7 gives: every session has Read and Grep, and reader sessions (ask, ingest, document Threads) have no shell.
- **Sections are not listed here.** A document's outline is computed when a brief or a card needs it.
- **Every address on the page can be read, and nothing else is on it.** Run and session ids stay out: no reader opens a transcript. A Thread's address reads through its task's timeline, where its reports are.
- **No live figures.** Turns and context of a running Thread stay on the board, so the file changes when work changes state and not on every model call.
- **Past Shuttle sessions are listed in one generated file beside `SHUTTLE.md`**, `SESSIONS.md`, one line each, newest first, capped at 50 lines. They belong to no project.

Size today: the `loom` project has 10 tasks, 3 documents and no memory entries, about 30 lines. At one line each, a project with 300 nodes is still a file no one loads whole.

## How a Thread walks

The brief is the task's neighbourhood, one hop out. It replaces the lists T1 and T2 describe and is built by the same function that writes `GRAPH.md`.

```
## T-006 and what it touches
Parents      T-003 doing "Build the Shuttle and Threads design"   (Context inline below)
Siblings     T-004 done · T-005 review · T-007 todo · …
Threads      T-006.1 "build the manifest" ended, report: "Outlines print; 3 tests added"   (you are T-006.2, continuing it)
Documents    loom:docs/design/threads/context.md  "What a Thread reads"  ~2.4K   linked from T-006
                 T1. The brief carries a manifest   L20-37   ~350     ← the section linked
                 T2. The memory index goes inline   L38-41   ~80
             t-003-design-review.md  "Design review…"  ~1.3K            of T-003
                 Must fix before building           L13-21   ~500
Memory       shuttle-never-starts-threads: Only the owner starts a Thread.
Mentioned by T-009 "…reuses the outline from [[T-006]]"
Notes        2026-11-24 me "keep the brief under 2K tokens"
```

- **Tier 1, in the brief:** cards and outlines. The task body and each ancestor's Context stay inline, as today.
- **Tier 2, by Read:** one section, by its line range. A linked section is marked so the Thread knows which one the task's author meant.
- **Tier 3, by following:** a section read contains its own `[[…]]` links; `Grep` on `GRAPH.md` gives the card and backlinks of anything the Thread meets. It follows an edge when the work calls for it and not before.
- **Capped at about 60 lines.** Past that the oldest mentions are dropped and one line says how many, with the grep that lists them.
- **A Thread adds edges as it works.** An artifact it writes names its task; a decision it records in memory ends `Source: [[T-006]]`; its report links what it made and what it relied on. The next Thread on a neighbouring task finds them without being told.

## How the Shuttle walks

- **The ledger (R3) is the graph cut at open work:** tasks with a Thread or waiting on the owner, across projects, same cards. Step 2 and this page build one function, not two.
- **T3 becomes a link.** "The Shuttle points, it does not paraphrase" is now mechanical: it writes `[[loom:docs/design/shuttle/context.md#R2]]` in the task's Context, and the pointer turns into an outline in the Thread's brief. A path in prose still works for a person and does nothing for the graph.
- **Questions about the past are a grep and a read.** "What did we decide about notes" is `Grep "note" GRAPH.md MEMORY.md`, which returns cards, then at most the three reads R5 allows. `GET /api/state` is not needed for it.
- **Its memory is the graph plus its own dated sessions.** "What did I ask you yesterday" is a read of the session list: each line names the tasks that session wrote, and those hold the detail.
- **It knows Threads by their own cards.** Each carries its purpose and the state the board derives, so "what is T-005 doing" is a grep that returns the task and every Thread weaving it. The Shuttle still never opens a transcript.

Its permissions do not change: `GRAPH.md` is under `projects/**`, readable, and generated, so not something it writes.

## Checked against DeepSeek's prototype

Read from the [prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)'s `docs/001-domain.md`, `docs/007-architecture.md` and `src/app/cards.ts` on 2026-11-24. It has no general graph and no shared memory. It has a small closed set of relations stored in SQLite (a Ticket subscribes to Threads, Threads correlate, a message replies to another) and one read tool, `orchestrator_read`, over resource paths such as `ticket/<id>`.

| Their rule | Here |
| --- | --- |
| "Every id a page shows reads through one of these, so a Session walks from one object to the next"; ids nothing reads by stay off the pages | Taken: every address in `GRAPH.md` is readable, and run ids are left out |
| A card is a 160-character preview, the full length and a `read` pointer; lists are capped (eight related Tickets) and carry the total | Same shape: one-line cards with sizes, a 60-line cap, a count of what was dropped |
| A worker's first message holds the assignment inline; it reads "only what one cuts" | Kept: the task body and ancestors' Context stay inline; the walk is for the rest |
| Relations that add context "never route" and "lend no authority" | Taken as the rule that an edge adds context, never authority |
| A message joins a Ticket only on an explicit reference (`#12`, a URL): "topic similarity alone is not enough" | Agrees with explicit links and no similarity search; their use of references people already write is why a bare task id counts |
| A worker follows a related Thread for context, or drops one as unrelated | A Thread adds links in its report; it cannot remove an edge except by editing its own files |
| A worker reads only its own Ticket's neighbourhood | Not taken: a Thread can read every file already, so hiding addresses would protect nothing |

Where Loom differs on purpose: their edges are stored rows behind a tool that every session of their harness has; Loom's are derived from files and read with Grep, because its reader sessions have no shell. They have no memory entries or documents as nodes, so the outline-by-link part has no counterpart there.

## What changes, and what does not

| Place | Change |
| --- | --- |
| `conventions.md` | The link syntax and its addresses; `GRAPH.md` and the Shuttle's session list in the layout as generated; the three kinds of artifact; a project as `T-000`; "link, do not restate" extended from memory to every file |
| `runs.ts`, `index.ts` | Timeline events are authored by address; a finished Thread's event lists what it changed; a run record keeps its purpose |
| `store.ts` | One function returning a project's nodes and edges; a writer for `GRAPH.md` beside `rebuildMemoryIndex` |
| `prompts.ts` | `taskPrompt` prints the neighbourhood where it prints artifact paths; the Shuttle prompt says to link and to grep |
| UI | `[[…]]` renders as a link on task pages, timelines and documents; a task page lists what links to it |

Roadmap: step 3 builds the links, the graph function and `GRAPH.md` (T-012), then the brief (T-006); steps 1 and 2 teach the Shuttle to link and keep its session list; steps 5 and 6 take the Thread changes; step 8 (T-011) makes a project a task and sources and repos artifact files. How to judge it: a Thread's peak context against T-009's 274K, and the number of whole-file reads in its transcript.

Unchanged: the task and memory formats, derived Thread states, the size rules of T6, who may write what. No graph database, no node ids beyond the addresses files already have, no stored edge.

## What is built

Step 3's first part: `projectGraph(slug)` in `store.ts` returns the nodes with their cards and the edges, and `writeGraph` writes `GRAPH.md` whenever a project file changes and at start. The UI renders `[[…]]` as links and the task page lists what links to it. The project's Graph tab draws every node and edge from `GET /api/projects/<slug>/graph` with a spring layout: the owner pans, zooms and drags nodes, done tasks are hollow green rings with struck-through labels, hovering a node shows its card and lights its neighbours, clicking opens it, and choosing a task narrows it to the task's subtree and everything one edge away; the parent and child tree is the tab's other view. Until the later steps land:

- **A project is `tasks/T-000.md`** (step 8), migrated once from `project.json` on start. Links and repositories are artifacts with `origin: link` and `origin: repo`; a migrated link keeps its old id as its name. The store still offers a `Project` view (name, status, summary, sources, repos) built from them, so the dashboard's project pages read as before; the project page links to the task page of `T-000`, which lists every task with no parent as its subtask.
- **A Thread is numbered by its task's `run` events** and its state is its run record's status; its report is the last `agent` comment after its start. No purpose yet (step 6).
- **"wrote" edges come from a Thread's finish event** (step 5), which lists what it edited in the project. There is no "continues" edge yet: the next Thread's start does not record which Thread it continues.
- **Sections are read from markdown only**; a link to a section of an HTML artifact resolves when the artifact exists (step 4 renders HTML).
- **The brief prints the neighbourhood** (step 3, second part), capped at 60 lines; mentions come last, newest first, so the cap drops the oldest.
- **Links inside code are not read**, so pages like this one can show the syntax: fenced blocks and inline code in markdown, `<pre>`, `<code>`, `<script>` and `<style>` in HTML. Frontmatter and an HTML `<head>` are skipped, since they name the task already.

## Open questions

1. **Do two Threads on one task collide?** The timeline is append-only and each coding Thread has its own worktree, so the task file's checklist is the one shared thing they both edit.
2. **Does one task need to wait on another by rule?** A mention says "waits on [[T-005]]" and the board does not act on it. A typed `after` field would let the board hold a Start button; nothing asks for that yet.
3. **Should a card show when a linked section changed after the link was written?** It would tell a Thread its pointer may be stale. It needs the link's date, which only timeline entries carry.
4. ~~Should the dashboard draw the live graph?~~ Yes ([ADR 0019](../adr/0019-shuttle-page-and-live-graph.md)): the project's Graph tab draws it.
