# 0030. A stretch Claude Code never priced gets a rough, rule-based estimate

- Status: Accepted
- Date: 2026-11-27
- Implementation: Built
- Design: [usage/tracking.md](../design/usage/tracking.md)

## Context

[0010](0010-usage-from-session-totals.md) trusts Claude Code's own figures, which come only on a result line. A session stopped or killed before that line made model calls that were billed but recorded as $0, so run costs and totals ran low. Showing "cost unknown" instead was tried and set aside: the owner wants a best estimate, "fully rule based and don't need to be very precise".

## Decision

When a stretch of a run (a start or resume) has no result line, its usage entry sums the token usage on its assistant lines, each model call once, and prices it with a small table of list prices per model family (Fable, Opus, Sonnet, Haiku; anything else as Opus), cache reads at 0.1× input and writes at 2×. Stretches with a result line keep Claude Code's figure. Records saved with model calls and $0 are re-read at startup.

## Consequences

No run with model calls shows $0, and nothing in the dashboard needs an "unknown" state. Loom now holds a price table that can go stale; that is accepted because only interrupted stretches use it. If Claude Code folds a killed stretch's tokens into the next resume's totals, that stretch is counted twice.
