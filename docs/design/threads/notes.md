# Notes: reaching a Thread while it runs

## Summary

A note is up to 100 words sent to a task's Thread by the owner or by an agent, in practice the Shuttle. One endpoint, addressed by task, records the note on the timeline and then delivers it into the running session. Only the owner's note starts a session: it resumes or restarts an ended Thread. The server, not the caller, says whose note it is. Most of the owner's controls over running work are this one call. Dispatch and the board are in [Dispatch and the Threads board](dispatch.md).

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

`POST /api/projects/<slug>/tasks/<T-nnn>/note {"text": "…"}`, used by the board, the task page and the Shuttle alike. Loom then does four things in order:

1. **Decides the author and writes the note on the task's timeline.** The author is the owner only when the request carries the token the server hands the dashboard page at load, kept in server memory and never in the data directory. Every other caller is recorded as an agent, whatever it claims. This is the Shuttle's write-through rule (R1) applied to notes: it is durable, the owner can see it, and a Thread that is later restarted from the files (rule T5 in [What a Thread reads](context.md)) still receives it.
2. **Thread running:** writes it to the session's input. It lands after the current step.
3. **Thread ended, note from the owner:** resumes the session if warm, restarts from the files if cold (T5). This is the only way a note starts a session, and it is how the owner continues a Thread they stopped.
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
| Answer | The question clears and the Thread goes on. | Clears `question`, then a note with the answer. |
| Send back | A reviewed task returns to its Thread with a comment. | Status back to `doing`, then a note. |
| Stop | The Thread halts now; the task shows broken with "stopped by you". | Existing stop. **A person's stop holds**: no agent's note and no automation restarts it. Only the owner does, with Continue or a note of their own. |
| Drop | The task and its Thread end. | Stop if live; the task goes to the trash, as deletes do today. The worktree is left for the owner to remove. |
| Tells the Shuttle instead | "Stop T-012", "tell T-013 to skip Windows" do the same things. | The Shuttle calls the same endpoints. The board and the conversation are two hands on one set of controls. |

Three of the six rows are the same call. Editing a task with a live Thread sends nothing by itself; the owner steers if the Thread needs to know. What this costs in code: `runs.ts` starts each session with its prompt on standard input and keeps the pipe open, closing it when the result arrives; `sendMessage` gains a branch for a live run. A note written in the instant a run is finishing is covered by the re-send rule above. The same change lets the owner send the Shuttle a second message while it is still answering the first, which is refused today.
