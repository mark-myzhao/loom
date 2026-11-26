# 0024. Documents get their look from a few layout markers the app draws

- Status: Accepted
- Date: 2026-11-25
- Implementation: Built
- Design: [threads/context.md](../design/threads/context.md) (T7)

## Context

ADR 0023 made markdown the source and the app's markdown view the template. Plain markdown read flat next to the hand-styled HTML pages it replaced: no summary box, no cards, no effort tags. The owner wants documents that are cheap for a model to load and pleasant for a person to read, and first proposed templated HTML. Four formats were compared on the same excerpt of T-001's research: plain markdown, markdown with layout markers, semantic HTML with a shared stylesheet, and the original hand-styled HTML. The owner chose markdown with markers.

## Decision

The app's markdown view draws five markers and no others: a `## Summary` section as a box; `> [!note]`, `> [!decision]` and `> [!warning]` as labelled callouts; a list between `::: cards` and `:::` as a grid of cards; a numbered level-4 heading (`#### 1. Title`) and its text as a card; `{small}`, `{medium}` and `{large}` as effort tags. They are defined for agents in `conventions.md` under "Layout markers". Documents still carry no HTML or styling. This amends ADR 0023.

Not chosen: semantic HTML with a shared stylesheet (every tag costs an agent tokens, and the brief would need a converter again); hand-styled HTML (each page carries and drifts its own styles); plain markdown alone (too flat for the owner to read with ease).

## Consequences

An agent pays a few characters per marker, and a document still reads as plain markdown anywhere the markers are not drawn. All documents share one look, and changing the template changes every document at once. A new marker needs a change to the renderer, the stylesheet and `conventions.md`, which keeps the set small on purpose. A standalone HTML export, if wanted later, renders the same markdown through the same template.
