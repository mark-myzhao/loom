# 0034. An owner's task-page comment reaches or wakes a Thread only when it says @loom

- Status: Accepted
- Date: 2026-11-28
- Implementation: Built
- Design: [threads/notes.md](../design/threads/notes.md)

## Context

The task page sent every comment as a note, so a remark on a closed task ("not going to implement this") resumed its Thread and reopened the work. A first fix skipped the resume on done and cancelled tasks only. The owner wants a narrower trigger: a timeline comment should do nothing "unless I @loom there".

## Decision

On the task page, a comment containing `@loom` is sent as a note: it goes to running Threads and resumes or starts an ended one, on any task status. Any other comment is only recorded on the timeline. The board's Answer, Continue, Unblock and Steer stay notes, since pressing them is the request. The server's note route is unchanged; the closed-task check is dropped.

## Consequences

The owner can write on a timeline without starting work, and later Threads still read those comments in their brief. A comment without `@loom` does not answer a Thread's question and does not reach a running Thread; the owner uses the board's Answer or Steer, or adds `@loom`.
