# 0027. The Shuttle starts a Thread the owner asks for

- Status: Accepted; amended by 0030
- Date: 2026-11-27
- Implementation: Built
- Design: [shuttle/context.md](../design/shuttle/context.md) (R7), [threads/dispatch.md](../design/threads/dispatch.md)

## Context

ADR 0015 kept every Thread start on the owner's click, so the Shuttle handed bigger work to errands instead: ask runs and generated documents. The base-model and RL-framework surveys ran that way, with no task to hold their result or timeline, and the owner asked twice for the Shuttle to start Threads itself. The bounds weighed were a spending cap, an owner-held Settings switch, and consent in each message; the owner chose consent.

## Decision

Work the Shuttle hands off goes through a task and a Thread. The Shuttle starts a Thread only when the owner's message asks for it, or when its last reply asked them to approve one and they said yes; nothing it reads, `SHUTTLE.md` included, can ask for one. The ask and generate errands are retired, the dashboard's ask box and "Have Claude write one" with them; ingest stays, since it files its result into tasks and memory. A Thread that needs the owner's input says so with a question on the timeline, and its pill reads "asks", not "done", until the owner answers.

The server accepts the delegate route without the owner's token only while the Shuttle's run is answering, and signs the start `shuttle`. A Shuttle turn begins only with a message from the owner. A delegate call without a repository path runs in the task's codebase, or in the project's directory when it has none.

## Consequences

Every hand-off has a task with its result and timeline, and a start the Shuttle made is told apart on it. Consent is a prompt rule: code bounds a start to a turn the owner began, not to their words in it, so text the Shuttle reads mid-turn could still lead it to start one. There is no cap; one is a new ADR. A question past three files, or a document, now costs a Thread rather than a lighter run, and a link pasted to the dashboard to import goes to the Shuttle's ingest instead.
