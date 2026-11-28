# 0010. Usage is recorded per session start, from the transcript's running totals

- Status: Accepted; amended by 0033
- Date: 2026-11-23
- Implementation: Built
- Design: [usage/tracking.md](../design/usage/tracking.md)

## Context

Optimising token use needs numbers per day, kind of run and task. Loom kept one cost per run and got it by adding `total_cost_usd` from every result line; that field is a running total for the session, so resumed runs were counted more than once (T-001 showed $72.34 for $10.33 of work).

## Decision

When a run ends, one function reads its transcript and stores a usage entry per start or resume, per model: the last session total before the next message minus the total before it. The run's cost is the sum of its entries, and its peak context is the largest prompt the main session sent. Older records are filled in from their transcripts at startup. One shared module rolls rows up for the Usage page and for `bun run usage`.

## Consequences

Costs are correct and can be placed on the day they were spent. No ledger file and no pricing table: Loom trusts Claude Code's own figures. Usage of a session killed before its result line is not recorded.
