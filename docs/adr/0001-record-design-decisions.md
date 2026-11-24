# 0001. Record design decisions as ADRs

- Status: Accepted
- Date: 2026-11-23
- Implementation: Built
- Design: [README.md](../design/README.md)

## Context

Loom's design was worked out in conversation and kept as task artifacts in the data directory, which is private to one machine and not versioned with the code. Decisions and their reasons were scattered through long design pages.

## Decision

Designs live in `docs/design`, one subject per page, grouped in folders by area. Each decision gets one numbered file in `docs/adr` with context, decision and consequences. An ADR is never rewritten once accepted: a change of mind is a new ADR that supersedes the old one, and the old one's status says so.

## Consequences

The design is reviewable with the code that implements it. Design pages can stay short because the history is elsewhere. The task artifacts for T-003 are frozen copies that point here.
