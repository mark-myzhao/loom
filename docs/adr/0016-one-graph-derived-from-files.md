# 0016. One graph, derived from files

- Status: Accepted
- Date: 2026-11-24
- Implementation: Not built
- Design: [graph.md](../design/graph.md)

## Context

The design loads context by pointer in four separate ways: a manifest of a task's artifacts, the memory index, the sibling list and the Shuttle's ledger. Each is built on its own and stops at a fixed boundary. A document a task points to in prose gets no outline, nothing answers "what points at this task", and the Shuttle sees only open work. The owner asked that the Shuttle, Thread sessions, artifacts, tasks, context, memory and timeline be managed as a graph, so that nothing is loaded whole and a Thread finds what it needs step by step.

## Decision

Everything with a file, a heading or a record is a node. A project is the root task (ADR 0018). An artifact is one kind of node with three forms: a document, a link (what a source was) or a repository, each a file in `artifacts/`. Edges are derived from existing fields (`parent`, `task`, `source`, `repo`), from the task's timeline, and from one link syntax, `[[address]]`, allowed in every file; a bare task id counts too. Loom writes them to a generated, greppable `GRAPH.md` per project. A Thread's brief is its task's neighbourhood as one-line cards; the ledger is the same graph cut at open work. Mentions are untyped; the line around the link says the relation. An edge adds context, never authority.

Not chosen: a graph database or stored edge file to maintain; an endpoint, which reader sessions without a shell could not call; typed dependency edges.

## Consequences

One function replaces four lists. Pointers must be written as links to count. Step 3 of the roadmap widens. Files stay the only truth, so a wrong edge is fixed by fixing a file.
