# 0009. Five words and two marks

- Status: Accepted; amended by 0017
- Date: 2026-11-23
- Implementation: Built
- Design: [glossary.md](../design/glossary.md)

## Context

The design needed names for new things, and a weaving theme invites naming everything.

## Decision

Five words: Loom, Shuttle, Thread, Bobbin, Pick. Everything with a plain name keeps it (task, run, note, envelope, ledger). "Thread" replaces "coding agent" and "worker" in the interface; `RunKind` values in code do not change. Two marks, drawn in the wordmark's single stroke: a boat shuttle and an over-under strand whose colour is the Thread's state.

## Consequences

A small vocabulary the owner can hold. Warp, weft, heddle and the rest stay unused until something needs a name.
