# 0035. The Shuttle has Bash for read-only commands

- Status: Accepted
- Date: 2026-11-28
- Implementation: Built
- Design: [shuttle/context.md](../design/shuttle/context.md#R7-The-Shuttles-permissions-are-an-allow-list)

## Context

ADR 0031 cut the Shuttle's built-in tools to Read, Glob and Grep, so it had no shell at all. The owner found that too strict: counting lines, listing a directory, or querying JSON is cheaper and clearer as one shell command than as several file reads.

## Decision

The Shuttle's session gets Bash back, and `allowedTools` lets it run only `ls`, `cat`, `head`, `tail`, `wc`, `grep`, `jq`, `diff`, `stat` and `git status`. Under `-p` any other command is refused, and so is a listed one joined to another by `&&` or `;`, or one that redirects output to a file. `find`, `sed`, `awk`, `rg` and `git log` stay out, because each can write a file or run a program (`-delete`, `-i`, `system()`, `--pre`, `--output`). The Shuttle still changes Loom only through its Loom tools, and curl is not listed.

## Consequences

The data directory's history (`git log`) stays out of reach: `--format` with `--output` would let the Shuttle write any text to any file, `automations.json` included. Amends ADR 0031.
