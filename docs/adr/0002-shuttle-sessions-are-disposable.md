# 0002. A Shuttle session is disposable

- Status: Accepted; amended by 0014
- Date: 2026-11-23
- Implementation: Not built
- Design: [shuttle/context.md](../design/shuttle/context.md)

## Context

The Shuttle was one session resumed forever. Loom is used in bursts hours apart, so most bursts open on an expired prompt cache and re-write the whole conversation at about twice the input price; and one conversation that covers every project fills with unrelated topics. None of DeepSeek's super-agent, Meta's Muse Code or Claude Duet publishes an answer for the router side.

## Decision

The Shuttle writes every decision, fact and preference to a file in the turn it learns it (R1). Loom starts a fresh session, a new bobbin, when the cache is cold (more than 55 minutes idle) or the context passes a budget, 100K to start (R2). The clock moves out of the system prompt so the cached prefix stays byte-identical (R4).

## Consequences

A cold start costs a small fixed prefix, not the accumulated conversation. Nothing may live only in the conversation, which the Shuttle's prompt must enforce. The budget is a guess until measured; see the roadmap.
