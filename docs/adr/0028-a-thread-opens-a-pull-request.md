# 0028. A Thread opens a pull request when its work is ready

- Status: Accepted
- Date: 2026-11-27
- Implementation: Built
- Design: [threads/dispatch.md](../design/threads/dispatch.md#skills-a-thread-loads)

## Context

A Thread committed locally and pushed nothing unless the owner's extra instructions asked. So each finished Thread left a branch in a worktree, and the owner asked for the push and pull request in a second step, every time.

## Decision

When a Thread's work is ready for review and its repository has a remote, it pushes its branch and opens a pull request against the default branch, or pushes to the one already open, with the description from `loom-thread:pr`, and names it in its report. It never pushes the default branch, and pushes nothing for work it stopped short on. Anything else outward-facing still needs the owner's extra instructions.

## Consequences

The owner reviews a Thread's work as a pull request with no extra step. Pushing publishes the branch to the remote: a private repository keeps it private, a public one does not. A document Thread in a project's directory has no remote and opens nothing. Extra instructions can still say not to push.
