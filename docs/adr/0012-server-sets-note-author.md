# 0012. The server sets a note's author, and only the owner's note starts a session

- Status: Accepted
- Date: 2026-11-23
- Implementation: Built
- Design: [threads/notes.md](../design/threads/notes.md)

## Context

ADR 0007 let any caller send a note and resumed an ended Thread for any note; ADR 0008 let the Shuttle send notes unasked. A review found three faults: any local caller could label a note as the owner's, which changes the task; a note restarted a Thread the owner had stopped; and a fact relayed to a finished Thread started a paid session.

## Decision

The server decides the author: the owner only when the request carries a token given to the dashboard page at load and held in server memory; every other caller is an agent. A note is injected into a running Thread whoever sent it. Only the owner's note resumes or restarts an ended Thread. Notes recorded after a session's last result are sent again on the next resume or restart. The label reads "from an agent", since the server cannot tell the Shuttle from another agent.

## Consequences

A person's stop holds against every agent. The Shuttle's own notes (ADR 0008) reach running Threads only. The label is not a security boundary against a Thread that deliberately forges a browser request; the limits on what a Thread may change remain the containment.
