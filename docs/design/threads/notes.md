# Notes: reaching a Thread while it runs

## Summary

A note is up to 100 words sent to a task's Threads, or to one of them, by the owner or by an agent, in practice the Shuttle. One endpoint, addressed by task, records the note on the timeline and then delivers it into the running session. Only the owner's note starts a session: it resumes or restarts an ended Thread. The server, not the caller, says whose note it is. Most of the owner's controls over running work are this one call. Dispatch and the board are in [Dispatch and the Threads board](dispatch.md).

## The mechanism

Today a message can reach a run only after it ends (`sendMessage` refuses a live one). That is too late for "skip Windows", or for "T-012 just renamed the route you are calling". Claude Code can take further messages on standard input while a headless session works (`--input-format stream-json`). Tested for this design:

```
 0.0s  sent: run `sleep 6` five times, one after another, then reply DONE
 1.9s  sleep 1 starts
 9.0s  sent: after the sleep running now, stop and reply PINEAPPLE
 9.9s  sleep 2 starts (already decided before the note was read)
16.0s  sleep 2 ends; the note is read here
17.2s  PINEAPPLE. Same session, 3 turns instead of 6.
```

One run, on the smallest model, with a trivial task: enough to show the mechanism, not to characterise it. What it shows: a note is delivered at the next step boundary, nothing in flight is lost, and since it is appended at the end of the context the prompt cache is untouched. A single long tool call (a ten-minute test suite) delays delivery until it returns; Stop remains for that.

## One door, addressed by task

`POST /api/projects/<slug>/tasks/<T-nnn>/note {"text": "…"}`, used by the board, the task page and the Shuttle alike. A note addressed to the task reaches every running Thread on it; `"thread": "T-006.2"` in the body narrows it to one. Loom then does four things in order:

1. **Decides the author and writes the note on the task's timeline.** The author is the owner only when the request carries the token the server hands the dashboard page at load, kept in server memory and never in the data directory. Every other caller is recorded as an agent, whatever it claims. This is the Shuttle's write-through rule (R1) applied to notes: it is durable, the owner can see it, and a Thread that later continues the work from the files (rule T5 in [What a Thread reads](context.md)) still receives it.
2. **Thread running:** writes it to the session's input. It lands after the current step.
3. **Thread ended, note from the owner:** resumes the session if warm, starts the next Thread from the files if cold (T5). This is the only way a note starts a session, and it is how the owner continues a Thread they stopped.
4. **Thread ended, note from an agent:** nothing more. An agent's note never starts a session, so a fact relayed to a finished Thread costs nothing and a stopped Thread stays stopped.
5. **Thread queued, or no Thread yet:** nothing more. The brief tells a Thread to read the notes on its task's timeline before it starts.

**Nothing is lost at the edges.** Loom closes a session's input when its result arrives, unless a note was written after that turn began; then it waits for the next result. Whenever a Thread is resumed or restarted, Loom sends again every note recorded after the session's last result, so a note written as a run ended or lost in a crash still arrives.

The Shuttle never needs to know which case applies, or a run id. It says who and what; Loom works out how.

## What a note may carry

- **At most 100 words, and pointers for the rest.** A note is paid for on every later turn of the Thread, like anything else in its context. "T-012 renamed `/ingest` to `/drop`; see its report on the timeline" and not the report.
- **It says whose words it is.** `Note from the owner:` changes the task. `Note from an agent:` is a fact to weigh; it does not widen the task or grant permission. The server cannot tell the Shuttle from any other agent, so it does not try. The Thread's brief states this, and DeepSeek draws the same line: a router's note "grants no authority".
- **The Shuttle relays, it does not instruct.** It passes on the owner's words as the owner's, and facts from other Threads as facts. It does not send its own plans or corrections into a Thread; if it thinks a Thread has gone wrong, it tells the owner.
- **Not for web content.** Text that came from a link or a document is never forwarded as a note; the note names the file.
- **The label is not a security boundary.** A Thread with a shell runs as the owner's user and can forge whatever a browser sends. The token stops an agent being mislabelled by accident or by following text it read; it does not stop a deliberate forgery. Task bodies and imported artifacts already reach a Thread's brief, so a note is one of several paths for outside text, and the limits on what a Thread may change are what contain it.

The owner has decided the Shuttle may send notes on its own judgement, within the limits above. Such a note reaches only a Thread that is running. It can do so only during a pick, since nothing else wakes it. In practice that is two cases: the owner asks it to ("tell T-013 to skip Windows"), or the envelope shows a finished Thread whose result another running Thread depends on.

## Adjusting work in flight

| The owner does | What happens | Mechanism |
| --- | --- | --- |
| Steer | The Thread reads the owner's message after its current step and carries on with it. | A note from the owner. |
| Answer | The question clears and the Thread goes on. | A note with the answer to the Thread that asked; the note is what clears its question. |
| Send back | A reviewed task returns to its Thread with a comment. | Status back to `in-progress`, then a note. |
| Stop | The Thread halts now; the task shows blocked, waiting on human, with "stopped". | Existing stop. **A person's stop holds**: no agent's note and no automation restarts it. Only the owner does, with Continue or a note of their own. |
| Drop | The task and its Thread end. | Stop if live; the task goes to the trash, as deletes do today. The worktree is left for the owner to remove. |
| Tells the Shuttle instead | "Stop T-012", "tell T-013 to skip Windows" do the same things. | The Shuttle calls the same endpoints. The board and the conversation are two hands on one set of controls. |

Three of the six rows are the same call. Editing a task with a live Thread sends nothing by itself; the owner steers if the Thread needs to know. What this costs in code: `runs.ts` starts each session with its prompt on standard input and keeps the pipe open, closing it when the result arrives; `sendMessage` gains a branch for a live run. A note written in the instant a run is finishing is covered by the re-send rule above. The same change lets the owner send the Shuttle a second message while it is still answering the first, which is refused today.

## As built

Step 5 built the above, with these choices:

- **Sessions read their input as a stream.** Each starts with `--input-format stream-json`; Loom writes the prompt and keeps the pipe open, and a note sent while the run is queued waits and follows the prompt. Loom closes the input at each result rather than waiting for a further one: Claude Code still reads what was already written before it ends, and a note that comes after the close is on the timeline after the session's last result (`resultAt` on the run record), so the next resume or restart sends it again.
- **The owner's token** is served at `GET /api/owner` only to a request a browser marks `Sec-Fetch-Site: same-origin`, and the page sends it on every change. Delegate refuses a request without it.
- **The 100-word cap applies to an agent's note.** The owner's own words are not cut.
- **A cold note from the owner starts the next Thread** in the earlier one's working directory with no new worktree, told to check the directory and git history first. Its brief carries the earlier Thread's card and every note.
- **Every start and resume is tracked**, not only the first: task changes are logged under the run's author (a Thread's address), and a Thread's finish event lists what it wrote, read from its Edit and Write calls inside the project. `GRAPH.md` derives "wrote" edges from it.
- **A task-page comment is a note only when it says `@loom`** ([ADR 0034](../../adr/0034-a-comment-wakes-threads-only-with-at-loom.md)). Without it the comment is recorded on the timeline and reaches no Thread, running or ended; a later Thread still reads it in its brief. "Comment & mark done" only records the comment. The board's Answer, Continue, Unblock and Steer are notes as before.
