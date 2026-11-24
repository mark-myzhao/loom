# 0003. Code writes the hand-over, not the model

- Status: Accepted
- Date: 2026-11-23
- Implementation: Built
- Design: [shuttle/context.md](../design/shuttle/context.md)

## Context

A fresh session needs to know what is open and what was just being said. The usual answer is a model-written summary: an extra call on the largest context, and summaries drift.

## Decision

A new bobbin opens with an envelope built by code: the standing instructions in `SHUTTLE.md`, a ledger of open work computed from task files and run records, and the last three exchanges verbatim (R3). No summarising call. Three exchanges is accepted as the starting number; the alternative, a "keep this bobbin" pin, is not built.

## Consequences

The hand-over cannot hallucinate and costs nothing to produce. A long discussion resumed after a gap may lose its thread; if that happens in use, revisit the number or add the pin with a new ADR.
