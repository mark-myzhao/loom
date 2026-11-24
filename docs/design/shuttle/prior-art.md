# Prior art for the Shuttle's memory design

## Summary

The Shuttle rules are a composition of published practice: file-based hand-over between sessions, context resets, a stable cached prefix. This page says where each rule comes from, which ideas were considered and left out, and what DeepSeek's super-agent, Meta's Muse Code and Claude Duet publish on the same questions. The rules themselves are in [The Shuttle's context and cache](context.md).

## Prior art: this is a memory design, and most of it exists

Where each comes from, and where Loom departs:

| Source | What it establishes | Here |
| --- | --- | --- |
| Anthropic, [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) Nov 2025 | Every session starts with no memory and gets its bearings from files the last one left: a progress log, a feature list in JSON, the git log, in a fixed start-up order. Compaction alone "doesn't always pass perfectly clear instructions to the next agent". | R1 and R3. Difference: their agent writes the progress notes; Loom's ledger is computed, because task files already hold the state. |
| Anthropic, [Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps) Mar 2026 | Names the choice: a *context reset* (fresh agent plus structured hand-off) against *compaction* (summarise in place). **A caution:** the author dropped resets once newer models stopped rushing near the context limit, because a reset costs "orchestration complexity, token overhead, and latency". | R2 is a reset. The caution applies to one long coherent task. The Shuttle resets for other reasons, which the post does not weigh: an expired cache and unrelated topics. |
| Anthropic, [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) Sep 2025 | Structured note-taking outside the window; keep "lightweight identifiers" and load at run time; sub-agents explore widely and return 1,000 to 2,000 tokens. | R5, and T1 to T4 in [What a Thread reads](../threads/context.md). |
| Amp, [Handoff](https://ampcode.com/news/handoff) Oct 2025 | Removed compaction from the product: it is "lossy" and "encourages long, meandering threads". The user states a goal; the model drafts the new thread's opening prompt and a file list, editable before sending. | The closest shipped equivalent of a bobbin swap. Theirs is manual, goal-directed and model-written; Loom's is automatic and code-written. Their version is the right shape for the manual "New conversation" button if the automatic one proves too thin. |
| Manus, [Context engineering for AI agents](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) Jul 2025 | Cache hit rate is "the single most important metric". Stable prefix, no timestamp at the start of the system prompt, append-only context. The file system is "the ultimate context"; drop content only when a path or URL can restore it. | R4 is their timestamp rule, found independently in the stashed code. R1 and the manifest are their restorable compression. |
| [Keepalive economics](https://arxiv.org/abs/2607.19214) preprint, Jul 2026 | Keeping a prefix warm beats letting it expire while the gap I < τ(w/r − 1). At Loom's one-hour tier that is about 17 hours. It compares only against re-writing the *same* prefix, never against a smaller fresh one, and concludes "never keep a dead session warm". | Keep-warm pings are cheaper than a swap for short gaps; see "Considered and left out". The owner decided not to pursue them. |
| Letta (MemGPT) | Memory blocks pinned in context that the agent edits; a background "sleep-time" agent that reorganises them between conversations (marked experimental). | `SHUTTLE.md` is one memory block. A sleep-time tidy of project memory is a saved automation, if memory ever gets messy. |
| [The Agent Board](https://arxiv.org/abs/2611.04100) preprint, Nov 2026 | A shared task table agents post to and watch. In its pilots a plain external watcher was cheaper than the model-run keeper, which also missed 3.6% of wake-ups. | Supports [Dispatch and the Threads board](../threads/dispatch.md): the board is derived by code and a finishing Thread does not wake the Shuttle. |

What I did not find anywhere: a design that treats provider cache expiry during idle time as the trigger for a reset, or that prices a fresh small session against resuming a large one. The keepalive paper comes nearest and stops short of it. The arXiv items are preprints read from abstracts or a single pass, and the Letta row is from its documentation summaries.

## Considered and left out

| Idea | Why not |
| --- | --- |
| Keep-warm pings | Cheaper than it looks, and not adopted yet. One ping an hour costs 0.1 × C, so against a swap of about 70K it wins for gaps under roughly 15 hours at 45K and 7 hours at 100K, *if the owner comes back*. It loses on every evening, night and weekend, it needs a timer, and it keeps stale topics in context. **Decided by the owner: not pursued.** A cold cache is acceptable as long as memory is good enough to start fresh, so the effort goes into R1 and R3, not into keeping sessions alive. |
| A model-written summary at each swap | An extra call on the largest context, and summaries drift. With R1 there is nothing left that only a summary could save. |
| One Shuttle per project | More feeds for the owner to watch, which is the attention cost the design exists to remove. Swapping gives the same cleanliness. Revisit only if one bobbin regularly fills inside an hour. |
| Relying on auto-compaction | It fires at the worst moment (largest context), invalidates the cache, and Loom cannot choose what survives. Kept as the backstop it already is. |
| Embedding search over history | The files are small, named and greppable. A second memory system is a second thing to keep true. |

## What three other systems do

Short answer for these three systems: the worker side is, in DeepSeek's prototype. The router side is not, in anything they publish; DeepSeek's own article lists it as open. Outside them the building blocks are well documented: see "Prior art" above.

| Question | DeepSeek super-agent | Meta Muse Code | Claude Duet |
| --- | --- | --- | --- |
| Router context over time | One persistent session that "cannot keep the full history of every task in its own context window". Objects carry ids; a recalled object inlines summaries and ids of its neighbours for the next hop ("Chain of Recall"). The prototype leans on the harness's own compaction: its router prompt says only "check ticket summaries after compaction to avoid duplicate work". open Section 8.1: over months "long-term memory becomes the main bottleneck"; "there is no definitive answer". | Background agents "maintain a context file" that sub-agents consult "should they lose their way". The model compacts its own 1M window. What the file holds and what compaction drops is not published. | "Maintains one conversation and adds updates as tasks progress." Inherits account memory, skills and connections. Nothing published on compaction or fresh sessions. |
| Prompt cache expiry | not addressed The only cache figure: sending follow-ups straight to workers cut cache-read tokens per experiment from 31.8M to 23.2M and router decisions by about 30%. | not addressed | not addressed It checks "every few hours" because more frequent checks "consume usage allowances faster": cost is managed by waking less. |
| Topic pollution | Kept out by rule, not cleaned up after: the router may not read code, logs, transcripts or linked documents, and may not rewrite a request into a plan. Section 8.3 admits the design assumes "one global context". | Not published. | Not published. |
| What a worker starts with | solved Title, at most 1,500 characters of assignment, and the source message as a card. Later inputs: 600 characters. A read pointer appears only where something was cut. Pages are 4,000 characters, lists 20 items. A worker can read only its own ticket's objects. Routing note from the router: 30 words at most. | Isolated worktree each; the shared context file on demand. Starting context not published. | A cloud VM per assignment. Not published. |
| What comes back | A report of at most 600 characters plus a read pointer; one structured question field. The router is told never to read transcripts. | Sub-agents "escalate when needed" and "hand control back". Format not published. | "Notifies the user." |
| Human control of running work | A panel of tickets; a person can write directly into a worker's session; "a person's pause holds" until a person lifts it. | Every action logged before it runs. No steering detail published. | Approval before sending, paying, signing or deleting. No task editing described. |

Sources: the prototype's `docs/003`, `004`, `007` and `prompts/`, read from a clone; the article through the Offloop translation; Muse Code through The Register (6 Aug 2026) and DataCamp; Duet through VentureBeat and AlphaSignal (21 Oct 2026). Muse and Duet coverage is second-hand and thin on internals, so "not published" means exactly that. Anthropic's own Duet article was not read.
