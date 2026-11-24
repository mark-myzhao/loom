# 0005. A Thread starts from an index, and documents stay small

- Status: Accepted; amended by 0016
- Date: 2026-11-23
- Implementation: Not built; the size rules are followed in `docs/design`
- Design: [threads/context.md](../design/threads/context.md)

## Context

A coding agent's prompt told it to read the task's artifacts, and it read all of them whole. A token read at turn one is re-read on every later turn: the T-009 run grew from 32K to 274K of context over 59 model calls. HTML costs an agent about twice its text.

## Decision

A Thread's brief carries the task, the memory index and a manifest: each document's title, size and sections with line ranges (T1, T2). Bodies are read a section at a time. Documents an agent works from are markdown, with a summary of at most 120 words, sections of about 1,500 tokens and about 8,000 tokens in all; larger ones are split and marked Over length (T6). HTML artifacts get a generated markdown rendering that agents read in place of the HTML (T7).

## Consequences

Thread context grows with what the work needs, not with what exists. Authors, people and agents, must keep documents sectioned. Visual pages need their facts repeated in markdown.
