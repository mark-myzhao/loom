# Super-agent design research and what Loom can take from it

## Summary

DeepSeek's article and prototype argue that human attention, not model capability, limits multi-task agent work. For Loom this means the owner should think in tasks and never in runs. The first reading took eight small ideas from it. A second reading takes the bigger one: Loom should *be* a super-agent. A resident router, the **Shuttle**, becomes the owner's one conversation with Loom; every other run is a worker it dispatches; and the rest of the UI becomes the place a human goes to inspect and decide. The Shuttle's first version is built (see "Thinking bigger"); the eight smaller ideas still apply and now have a home.

## What was read

| Source | How it was read |
| --- | --- |
| [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) | README, docs 000 to 005 and 007, and the worker prompts, directly from GitHub |
| "Exploring Super-agent Design: Towards a More Autonomous Agent System" (DeepSeek Harness team) | Through a [third-party English translation](https://offloop.org/learn/exploring-deepseek-super-agent-design); the [WeChat original](https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg) and the X post could not be fetched |

The repository says it is a research prototype, not an official product, and not identical to the system the article describes.

## What they built

- **Thesis.** "The ceiling for a single task is set by model capability; the ceiling for multiple tasks is set by human attention." One person tracks about three to five sessions. Sessions should be "an implementation detail of the system, not a cognitive burden for users."
- **Two layers.** A long-lived Router talks to people and assigns work but executes nothing. Workers each take one task in an isolated context and report to the Router, never to people.
- **Event-driven.** Inputs are events from chat, GitHub and CI. Code filters them first (allowed lists, scopes); a model judges only what is left. Follow-ups on a conversation go straight to the worker that owns it.
- **Context as a cache.** Put a summary and an ID in the window, keep the full content outside, and let the model follow IDs to recall it.
- **Acting in advance.** Work silently in the background and speak only if the result is valuable.
- **Watchdog.** A separate session judges whether workers make real progress, because most failures are loops or drift, not crashes.
- **The prototype's rule.** "Take as little human attention as possible, and give as much value as possible." The agent acts only when asked or when a written rule allows it, speaks only when a person must act or can use a result, asks one concrete question at a time, stops by impact and not by effort, and reports honestly.

Their experiment figures (median completion 12.4 minutes; batching cut amortized decision time from 6.4 to 1.6 seconds) come from a synthetic workload that the authors call preliminary.

## Thinking bigger: Loom as a super-agent

The first pass treated DeepSeek's design as a list of features to borrow. Its real claim is architectural: the person talks to one long-lived agent, and sessions are an implementation detail. Loom already has the workers (ingest, ask, document and coding-agent runs) and the shared memory (plain files). What it lacked was the router.

### Two surfaces

| Surface | Who it is for | What it holds |
| --- | --- | --- |
| **The Shuttle feed** (top of Today) | The owner thinking out loud | One ongoing conversation. Notes, links, questions and "have an agent do X" all go here. The Shuttle answers, files, dispatches, and reports back. |
| **The workbench** (projects, tasks, documents, Activity) | The owner diving in | The durable record: task pages, timelines, artifacts, run transcripts. Every Shuttle reply links into it. |

The name: on a loom, the shuttle is what carries the weft thread back and forth across the warp. The Shuttle carries each thread of the owner's attention to the task, project or worker it belongs to, and back.

### What the Shuttle is (built)

- **One conversation, resumed.** Each message resumes the same Claude Code session (`POST /api/shuttle`). "New conversation" starts a fresh one; Claude Code compacts a long one on its own.
- **Routes, does not execute.** It answers from the files and makes small edits itself (tasks, statuses, memory). Anything that reads sources or writes code goes to a worker run through Loom's own API. It never fetches links: those go to ingest. Its only shell access is `curl` to Loom's loopback API, so untrusted web content never reaches the session that can dispatch work.
- **Workers report to the router.** Runs that ended since the Shuttle's last reply ride along with the owner's next message, as a "Loom:" note. The Shuttle reads what changed and tells the owner only what needs them. Nothing wakes it on its own, so an idle Shuttle costs nothing.
- **Context as a cache.** The conversation holds ids and one-line summaries; the files hold the content. `SHUTTLE.md` is its own notebook for standing instructions ("replies as bullets", "you may delegate p3 fixes in repo X"), read at the start of every conversation.
- **Attention rules in the prompt.** Lead with what needs the owner, one concrete question at a time, links into the workbench, honest status, delegate only when asked or allowed by a written rule.
- **Never waits in line.** It skips the concurrency queue, so a busy afternoon of agents does not make the conversation lag.

### Where it goes next

1. **The Shuttle proposes, the workbench disposes.** The eight ideas below become Shuttle behaviour rather than separate widgets: "Waiting on human" is the top of every Shuttle reply; an agent's question is relayed by the Shuttle and the owner's answer resumes the worker (`POST /api/runs/<id>/message`); a run that ends without a report is called out, and the task set to `blocked`.
2. **Events, not only messages.** DeepSeek's router is fed by chat, GitHub and CI. Loom's equivalent: automations, finished runs, and later GitHub or Slack watches post events to the Shuttle. Code filters first (only the owner's repos, only failing checks); the model judges what is left; events are batched into one turn.
3. **Acting in advance, quietly.** A morning automation asks the Shuttle to look over the day: draft research for new tasks, check stale `in-progress` tasks. It speaks only when the result is worth the owner's time; otherwise the feed stays empty.
4. **A watchdog that is the router.** When the Shuttle relays a finished or long-running run it is already the right place to judge progress versus loops: turns and cost per run are on the record. It can stop a run that is spinning, under a SHUTTLE.md rule.
5. **More feeds.** One feed per role (a research desk, a code desk) or per project, each a Shuttle with its own notebook, sharing the same workers and files. The design keeps this cheap: a feed is one run id in `state.json` plus one system prompt.
6. **Measure attention.** The figure that matters is owner time per finished task. Loom can count owner messages, answers and reviews per task and show the trend; that is the number every change above should move.

### Risks

- **Cost.** Every Shuttle turn is a model call over a growing conversation. Keep replies short, prefer "New conversation" when a thread is done, and watch its cost in Activity.
- **Authority creep.** The Shuttle can delegate coding work. The rule is explicit consent or a written SHUTTLE.md rule; Activity keeps every dispatch auditable.
- **Prompt injection.** The Shuttle reads task bodies and run results that came from the web. Its tools are limited to the data directory and Loom's API, and coding agents still run under their own permission mode, but a poisoned task could still ask it to dispatch work. Owner consent for delegation is the backstop.

## Smaller ideas, by value

### 1. Lead Today with "Waiting on human"

Their panel lists first what waits for a person, and a healthy state takes no space. Loom's Today (`web/views/Today.tsx`) shows live runs and then all open tasks; failed or interrupted runs appear only in Activity. A top section would hold tasks in `review` and `blocked` plus failed and interrupted runs, each labelled by what it needs from the owner.

### 2. One structured question

Their worker puts a single concrete question in a dedicated report field, so it reaches the person. Loom's agent writes "open questions" inside a free-text report on the timeline. A `question` frontmatter field on a blocked task, shown on Today with an answer box, fixes that. The answer resumes the same session through the existing `sendMessage` in `server/runs.ts`. The field has to be added in `store.ts`, `conventions.md` and `prompts.ts` together.

### 3. Honest task state

Their ticket derives its stage from stored facts, not from the session. In Loom, `delegate` in `server/index.ts` sets the task to `in-progress`, and the completion hook only appends a timeline event. If the agent dies before editing the task file, the task stays `in-progress` with nothing running. The hook should set `blocked` when the run ends failed, stopped or interrupted and the task is still `in-progress`.

### 4. Stop by impact, not effort

Their scope prompt: a local change goes all the way to a reviewable result; a change that breaks caller expectations or needs a design decision stops with a named question. A finished job with nothing for a person to do is reported as "dropped", and an incomplete draft is never "ready". Loom's `taskPrompt` only says "make reasonable decisions yourself". This is a few lines of prompt text.

### 5. Follow-ups reach the same worker

In their design a later human message on a ticket resumes its session, directory and branch. In Loom, a comment on a task with a finished agent run could offer "send to agent" and resume that run.

### 6. Recovery after a restart

They restart interrupted work with a note to check the directory and git history before repeating anything, and retry passing provider or network errors three times. Loom marks such runs `interrupted` and leaves them. A "Continue" action that resumes with that recovery note is the small version.

### 7. Batch waiting drops

Their Router accumulates events during one inference round and handles them together. Loom starts one ingest run per drop. Drops are already saved to `inbox/` first, so one ingest run could take every unrouted file. This would also stop two ingest runs editing the same project at once; whether Loom guards against that today has not been checked.

### 8. A cheap watchdog

Loom already records turns and cost per run. A run past a turn or time threshold could appear under "Waiting on human" with a Stop button. A model-judged watchdog session is more than a single-user tool needs.

### No code needed

- **Act in advance.** A saved daily Claude automation can draft a research artifact for each new task that lacks one. An automation run that changed nothing should take no space.
- **Setup by agent.** The README's "First use" section could be one line: ask your coding agent to read it and set Loom up with you.

### Smaller

- **Deterministic path before the model.** A drop that is only a link already registered in one project's `sources` could be filed there without asking Claude to choose.

## What Loom already does

- **Context as a cache.** The memory index with on-demand entry bodies, and short tasks with artifacts for detail.
- **Channel bandwidth.** Short run summaries, long artifacts.
- **Untrusted input.** The dropped item is fenced as material, and reader sessions have no shell.
- **Few concepts, plain files, worktree isolation.**

## Not worth borrowing

| Idea | Why not |
| --- | --- |
| Policy, Mandate, Eval, admission tables | They decide who on a team may start work; Loom has one owner on loopback |
| Versioned prompt overrides with "default updated" diffs | Config for the future, which Loom's rules forbid |
| Cloud compute with a device daemon, Router sharding, agent-to-agent collaboration | Team and always-online problems |
