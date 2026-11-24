# 0019. The Shuttle has its own page, a new mark, and the dashboard draws the graph

- Status: Accepted
- Date: 2026-11-24
- Implementation: Built
- Design: [graph.md](../design/graph.md), [dispatch.md](../design/threads/dispatch.md), [marks.md](../design/brand/marks.md)

## Context

The Shuttle sat on top of Today with a paragraph explaining what to paste into it, which pushed the Threads board below the fold. The graph (ADR 0016) existed only as `GRAPH.md` and a static design picture, leaving open whether the dashboard should draw it. The owner found the boat-shuttle mark hard to read.

## Decision

The Shuttle moves to its own page, linked from the rail under Today, with no explanatory text; Today leads with the board. The project's Graph tab draws the live graph from `projectGraph`, with a spring layout computed in the browser and no stored positions; the parent and child tree stays as the tab's other view. The Shuttle's mark becomes the weft crossing three warp threads as an arrow, amending ADR 0009.

Not chosen: a graph library, since one small layout function draws a project's few dozen nodes.

## Consequences

Talking to the Shuttle takes one click from anywhere. A project with hundreds of nodes would make the layout slow (it is quadratic); that is the point to revisit it.
