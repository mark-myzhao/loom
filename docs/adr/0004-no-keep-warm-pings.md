# 0004. Let the prompt cache expire

- Status: Accepted
- Date: 2026-11-23
- Implementation: Decided; nothing to build
- Design: [shuttle/prior-art.md](../design/shuttle/prior-art.md)

## Context

Pinging a session every hour keeps its cache warm for 0.1 × its context per ping. That is cheaper than a fresh start for gaps up to roughly 7 to 15 hours, if the owner comes back.

## Decision

No keep-warm pings. A cold cache is acceptable as long as memory is good enough to start fresh, so the effort goes into write-through and the hand-over (ADRs 0002 and 0003).

## Consequences

No timer, no spend while nobody is there, and stale topics do not stay in context. Short gaps just over an hour cost more than they would with pings.
