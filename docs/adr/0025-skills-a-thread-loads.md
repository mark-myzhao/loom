# 0025. Threads load Loom's own skills from a plugin in the checkout

- Status: Accepted
- Date: 2026-11-25
- Implementation: Built
- Design: [threads/dispatch.md](../design/threads/dispatch.md) ("Skills a Thread loads")

## Context

The owner writes pull request descriptions with the `pr` skill from mattpocock/skills and wants a Thread's pull requests to use the same format. A Thread runs in whichever repository it works on, so the repository's skills vary, and the owner's own plugins live on one machine only.

## Decision

Loom keeps a Claude Code plugin at `plugins/thread` and passes it to every Thread with `--plugin-dir`. It holds a copy of the `pr` skill, unchanged and with its MIT licence and credits, loaded as `loom-thread:pr`; the brief tells a Thread to use it whenever it opens a pull request.

Not chosen: putting the format in the brief (every Thread would pay for it, though few open a pull request); relying on the owner's installed plugin (not there on another machine, and it can change under Loom).

## Consequences

Threads write pull requests the same way on any machine that has the Loom checkout. Each skill in the plugin adds its description to every Thread's context, so the set stays small. The copy does not follow upstream changes; updating it is a deliberate edit.
