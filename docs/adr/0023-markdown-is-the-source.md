# 0023. Markdown is the source; HTML is only a visual a markdown document links

- Status: Accepted; amended by 0024
- Date: 2026-11-24
- Implementation: Built; HTML pages written before it are converted to markdown by hand, as project data
- Design: [threads/context.md](../design/threads/context.md) (T6, T7)

## Context

ADR 0005 let an artifact be a whole HTML page and planned for Loom to keep a generated markdown rendering of each one for agents (rule T7). The rendering measured only 24% to 41% smaller than the HTML, needed a converter and a second copy of every page to keep in step, and the design review suggested cutting it. The owner raised a third option and chose it: "load contents from md files, only render free style html for interactive elements like diagram".

## Decision

Facts live in markdown. An HTML artifact is only a diagram or an interactive piece, holds no fact its markdown document lacks, and is linked from that document in a paragraph of its own, where the app's markdown view shows it inline in a sandboxed frame. The markdown view is the template for every document, so no page carries its own layout. A Thread's brief lists markdown only; `GRAPH.md` still lists every file. No rendering is generated. This amends ADR 0005.

Not chosen: the generated rendering (two copies of each page); cutting HTML altogether (a drawing or a live control has no markdown form).

## Consequences

An agent never pays for markup, and there is nothing to regenerate. A document's look is the app's, the same everywhere. A whole-page HTML artifact written before this is invisible to briefs until it is rewritten as markdown. The size check still counts a visual's markup, so a large drawing reads Over length although no agent opens it.
