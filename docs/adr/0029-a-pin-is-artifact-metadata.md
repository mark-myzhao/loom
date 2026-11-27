# 0029. A pin is a line of the artifact's own metadata

- Status: Accepted
- Date: 2026-11-26
- Implementation: Built
- Design: [graph.md](../design/graph.md)

## Context

A project gathers dozens of artifacts, and the owner wants a few kept at hand. The mark has to be stored somewhere. `state.json` stays out of the snapshots, so a pin there would not survive a restore. A list on `T-000` would name files that can be renamed or deleted under it.

## Decision

A pin is `pinned: true` in the artifact's frontmatter, or `<meta name="loom:pinned" content="true">` in an HTML artifact's head. Only the owner sets it, from the dashboard. Writing it changes that one line and keeps the file's modification time, because pinning is not an edit and lists sort by that time.

The Artifacts tab shows pinned artifacts first, then one group per task. Within a group an artifact sits under the one that links to it, read from the "mentions" edges; no order is stored.

## Consequences

A pin travels with its file through backup, rename and trash. A pin makes a commit in the data repository. Agents see the line and are told to leave it as they find it.
