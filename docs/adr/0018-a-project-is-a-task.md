# 0018. A project is a task, and sources and repos are artifacts

- Status: Accepted
- Date: 2026-11-24
- Implementation: Built, except that the project page keeps its tabs beside the task page of `T-000` (roadmap step 8)
- Design: [graph.md](../design/graph.md)

## Context

A project and a task were two kinds of thing: two files, two sets of status words, two pages. In the graph they behave the same: each has a title, a status, a context, subtasks, artifacts and Threads, and tasks already nest to any depth. A project's sources and repos were lists inside `project.json`, though in the graph a source is an artifact whose body lives elsewhere. The owner asked to unify them to make the design simpler.

## Decision

A project is the root task of its directory, `tasks/T-000.md`, with a timeline like any task. Its name becomes the title, its summary the Context, and its status a task status (`active` to `doing`, `paused` to `todo`). A task with no `parent` is part of it. Each source becomes an artifact file with `origin: link` and each repo one with `origin: repo`, the URL or path in `source`. `project.json` goes. The slug, id numbering, memory and artifacts stay with the directory.

Not chosen: unifying only in the graph, which keeps two formats and two pages.

## Consequences

One kind of work node and one kind of knowledge node, each a markdown file. A project gains a timeline and exit criteria, and a Thread can work on it. It needs a one-time migration, in which a migrated link keeps its old id as its filename so memory entries still resolve, and changes to the store, the conventions and the UI. `paused` is no longer distinct from not started. Projects do not nest inside projects.
