---
name: loom
description: Work with the owner's Loom project dashboard. Use when they ask about their projects, tasks, project memory or documents ("what's on my plate", "what did we decide about X"), want a task, note or memory entry added or changed, or want a task handed to a coding agent or one of their automations run.
---

# Loom

Loom is the owner's local project notebook. Its whole database is a directory of markdown
and JSON files that you can read and edit directly; a local server watches that directory
and shows it in a browser.

## Find it

- The server listens on `http://127.0.0.1:4400` unless `LOOM_URL` says otherwise.
- `curl -s "${LOOM_URL:-http://127.0.0.1:4400}/api/state"` returns a snapshot. Its
  `dataDir` field is the data directory; `projects` lists every project with its tasks.
- If the server is not running, the data directory is `$DASH_DATA_DIR`, or `data/` inside
  the Loom checkout. To start the server run `bun start` in the checkout, or
  `scripts/launchd.sh install` to keep it running after login. If you cannot find the
  checkout, ask the owner where it is.

## Read: answer from the files

Read `<dataDir>/CLAUDE.md` first. It defines every file format; follow it exactly.

- Projects: `projects/<slug>/project.json` (name, status, summary, sources, repos).
- Tasks: `projects/<slug>/tasks/T-nnn.md`, with history in `T-nnn.log.md`.
- Memory: `projects/<slug>/memory/MEMORY.md` is the index; open the entries it lists.
- Documents: `projects/<slug>/artifacts/`.

For "what should I work on", list tasks whose status is not `done`, lead with `review` and
`blocked`, then order by priority and due date.

## Change: edit the files

Edit the files as the conventions describe; the server notices. You are not a run that
Loom started, so record your own timeline events: when you create a task or change its
status, priority, due date, title, repo or parent, append the matching `created`,
`status` or `field` event to its `.log.md`, authored `claude`, plus a `comment` saying why
if it is not obvious. Never edit `MEMORY.md`, `config.json`, `automations.json`, `state.json` or `runs/`.

## Act: call the API for anything that needs a supervised run

Mutations must be JSON (`-H 'Content-Type: application/json'`). Each returns the run's
metadata; its `id` opens the transcript at `<LOOM_URL>/#/activity?run=<id>`. Give the owner
that link.

| To | Call |
| --- | --- |
| Talk to the Shuttle, Loom's resident router (the owner's main conversation) | `POST /api/shuttle` with `{"text": "...", "fresh": false}` |
| Run a saved automation (`automations` in the snapshot lists them) | `POST /api/automations/<id>/run` with `{}` |
| File notes or links | `POST /api/ingest` with `{"text": "...", "project": "<slug, optional>"}` |
| Ask a project a question | `POST /api/projects/<slug>/ask` with `{"text": "..."}` |
| Have a document written or imported | `POST /api/projects/<slug>/artifacts/generate` with `{"text": "...", "taskId": "T-nnn, optional"}` |
| Hand a task to a coding agent | `POST /api/projects/<slug>/tasks/<T-nnn>/delegate` with `{"repoPath": "/abs/checkout", "instructions": "optional", "worktree": true}` |
| Check a run | `GET /api/runs/<id>` |

A delegated task must name its repository: use the path of a codebase registered in the
project's `repos`, or ask the owner which checkout to use. Do not delegate a task that
already has an agent working on it (the API answers 409).
