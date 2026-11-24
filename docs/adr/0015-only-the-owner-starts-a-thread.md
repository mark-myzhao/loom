# 0015. Only the owner starts a Thread

- Status: Accepted
- Date: 2026-11-23
- Implementation: Partly built: delegate is off the Shuttle's list; the server check needs the owner token (roadmap step 5)
- Design: [shuttle/context.md](../design/shuttle/context.md)

## Context

The Shuttle could start a Thread when the owner asked or when a standing rule in `SHUTTLE.md` allowed it. The Shuttle writes `SHUTTLE.md` itself, so the file that granted permission to spend was editable by the agent being granted it. ADR 0011 made that a prompt rule, which holds only while the Shuttle follows its prompt. Code cannot tell a start the owner asked for from one the Shuttle chose: both are the same call. The alternatives were a daily cap on agent-started Threads, or taking `SHUTTLE.md` out of the Shuttle's write list.

## Decision

A Thread starts only on the owner's click. The Shuttle writes the task, and the board shows it as proposed with a Start button. The delegate route is off the Shuttle's allow-list, and the server refuses it without the owner's token (ADR 0012). No standing instruction can lift this. The Shuttle may still start errands: an ask run, an ingest run, a generated document.

## Consequences

The owner controls every Thread's start, and what the Shuttle reads cannot cause one. "Have an agent look at X" in the conversation costs one extra click on the board. Chains of Threads cannot run unattended. If the click proves tiresome, a cap or an owner-held setting is a new ADR.
