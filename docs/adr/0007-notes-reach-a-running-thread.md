# 0007. One note endpoint, addressed by task, reaches a running Thread

- Status: Accepted; amended by 0012
- Date: 2026-11-23
- Implementation: Not built; the mechanism is tested
- Design: [threads/notes.md](../design/threads/notes.md)

## Context

A message could reach a run only after it ended, too late for "skip Windows". Claude Code accepts further messages on standard input while a headless session works; tested, a note is read after the tool call in flight, in the same session, without touching the prompt cache.

## Decision

`POST /api/projects/<slug>/tasks/<T-nnn>/note` records the note on the task's timeline first, then delivers it: into the running session, by resuming or restarting an ended one, or not at all when no Thread exists yet. A note is at most 100 words, says whether it is the owner's or the Shuttle's, and never carries text fetched from the web. Steer, Answer, Send back and task edits all use it.

## Consequences

The owner and the Shuttle address a task and never a run id. Sessions must be started with their input pipe held open. A single long tool call delays delivery until it returns; Stop remains for that.
