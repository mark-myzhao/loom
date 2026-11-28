# 0030. The Shuttle's end-to-end tests run real Claude Code, on demand, under a token budget

- Status: Accepted
- Date: 2026-11-27
- Implementation: Built
- Design: [shuttle/context.md](../design/shuttle/context.md#End-to-end-tests)

## Context

`bun test` drives the server with a stand-in for the `claude` binary, so it shows that Loom passes messages and records runs, not that the Shuttle gets the owner's request done, nor what that costs. Changing how the Shuttle writes to Loom (curl through Bash today, dedicated tools next) needs a before and after. Real sessions spend real tokens.

## Decision

`bun run e2e` starts the real server on a throwaway data directory, seeds one project, and sends each case as one message in a fresh Shuttle conversation. A case checks the files afterwards. The script is not a `*.test.ts` file, so `bun test` never runs it.

Every token counts toward the budget (default 2M, `--budget`), cache reads included, read live from the transcripts. Past it, the live runs are stopped and the remaining cases are not run. A Thread or ingest run the Shuttle starts is stopped at once: its start is the evidence.

The report is a markdown table: done or why not, turns, tool calls and errors, tokens by kind, cost, time.

## Consequences

A full run costs a few dollars, so it is run by hand. The budget can overshoot by the model call in flight. A stopped run has no price from Claude Code; the report marks it unpriced.
