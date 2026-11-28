# 0031. The Shuttle has a few wide Loom tools, and no Bash

- Status: Accepted; amended by 0035
- Date: 2026-11-27
- Implementation: Built
- Design: [shuttle/context.md](../design/shuttle/context.md#R7-The-Shuttles-permissions-are-an-allow-list)

## Context

The Shuttle called its routes with curl through Bash (ADR 0026). Claude Code refused some of those commands, JSON had to be quoted on one line with no apostrophe, the route table sat in the prompt, and a write answered with the whole task. The owner asked for dedicated tools: "Terse responses and Few, wide tools; the interface should be simple while the capability of tools should be high".

## Decision

Loom serves an MCP endpoint, `POST /api/mcp`, stateless JSON-RPC with plain JSON answers. The Shuttle's session gets it with `--mcp-config` and `--strict-mcp-config`, and its built-in tools are cut to Read, Glob and Grep with `--tools`, so it has no shell. Five tools cover the routes it used: `task` (create, change, tick), `memory` (an entry, or the notebook without a project), `thread` (start, note, stop), `ingest` and `look`. A write answers with the id and what changed, never a body. The server's checks stay as they were: no config, automations or deletes, and a Thread start only while the Shuttle answers the owner.

## Consequences

`bun run e2e` against the curl baseline: 8 of 8 cases done in both; 306k tokens and $1.13 against 715k and $2.89. The fixed prefix fell from about 17k-20k uncached tokens to about 7k. `PUT /api/shuttle/notebook` is gone; the other routes stay for the dashboard and the `loom` skill. Amends ADR 0011 and 0026.
