// Routing, actions, automations and the watcher.

import { existsSync, watch } from "node:fs";
import { join, sep } from "node:path";
import index from "../web/index.html";
import { initBackup, pushIfDue, scheduleBackup } from "./backup";
import { artifactPrompt, askPrompt, automationPrompt, ingestPrompt, SHUTTLE_ROUTES, shuttlePrompt, taskPrompt } from "./prompts";
import { findLiveRun, getRun, hasLiveRuns, initRuns, listRuns, noteText, readTranscript, sendMessage, sendNote, startRun, stopRun, subscribe, type RunInit } from "./runs";
import * as store from "./store";
import { DATA, HttpError } from "./store";
import { readTelemetry, track } from "./telemetry";
import { compact, usageRows } from "./usage";
import { BOARD_GROUPS, CACHE_COLD_MS, isClosed, ownerText, type Automation, type BoardRow, type Config, type RunMeta, type RunSpec, type Snapshot, type Task, type TaskDetail, type TaskSummary } from "./types";

const PORT = Number(process.env.PORT) || 4400;
const PROD = process.env.NODE_ENV === "production";
const bad = (msg: string, status = 400): never => {
  throw new HttpError(status, msg);
};

// ---------- change signal (/api/events) ----------

const encoder = new TextEncoder();
const listeners = new Set<(chunk: string) => void>();
let notifyTimer: ReturnType<typeof setTimeout> | undefined;

/** Debounced 250 ms: every browser refetches its snapshot. */
function notify() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    for (const send of listeners) send("data: changed\n\n");
  }, 250);
}

function sse(req: Request, start: (send: (chunk: string) => void, close: () => void) => () => void): Response {
  server.timeout(req, 0);
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };
      const ping = setInterval(() => send(": ping\n\n"), 20_000);
      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(ping);
        try {
          controller.close();
        } catch {}
      };
      const stop = start(send, close);
      cleanup = () => {
        open = false;
        clearInterval(ping);
        stop();
      };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

// ---------- watcher ----------

const projectTimers = new Map<string, ReturnType<typeof setTimeout>>();

function startWatcher() {
  watch(DATA, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const parts = String(filename).split(sep);
    const name = parts[parts.length - 1]!;
    // Run records, git internals and temporary write files are not data changes.
    if (parts[0] === "runs" || parts[0] === ".git" || name.includes(".tmp-") || name === "server.log" || name === ".DS_Store") return;
    notify();
    scheduleBackup();
    // The generated indexes follow any change to the project's files, and write only when they differ.
    if (parts[0] === "projects" && name !== "MEMORY.md" && name !== "GRAPH.md" && store.isSlug(parts[1])) {
      const slug = parts[1]!;
      clearTimeout(projectTimers.get(slug));
      projectTimers.set(slug, setTimeout(() => {
        projectTimers.delete(slug);
        try {
          store.rebuildMemoryIndex(slug);
          store.writeGraph(slug);
        } catch (e) {
          console.error(`indexes for ${slug}:`, (e as Error).message);
        }
      }, 300));
    }
  });
}

// ---------- change tracking ----------

type TaskSnap = Pick<Task, "status" | "priority" | "due" | "title" | "repo" | "parent">;
interface Baseline {
  takenAt: string;
  tasks: Map<string, TaskSnap>;
}

function snapshotTasks(): Baseline {
  const tasks = new Map<string, TaskSnap>();
  for (const slug of store.listProjectSlugs()) {
    for (const t of store.listTasks(slug)) {
      tasks.set(`${slug}/${t.id}`, { status: t.status, priority: t.priority, due: t.due, title: t.title, repo: t.repo, parent: t.parent });
    }
  }
  return { takenAt: store.nowIso(), tasks };
}

/** Diffs every task against the baseline and writes what changed onto the timelines. */
function recordChanges(before: Baseline, by: string, runId?: string): Baseline {
  const after = snapshotTasks();
  const suffix = runId ? ` · run ${runId}` : "";
  for (const [key, now] of after.tasks) {
    const [slug, id] = key.split("/") as [string, string];
    const was = before.tasks.get(key);
    const log = store.readTimeline(slug, id);
    if (!was) {
      if (!log.some((e) => e.type === "created")) store.appendEvent(slug, id, { by, type: "created", detail: runId ? `run ${runId}` : "" });
      continue;
    }
    // The owner (or the session itself) may already have logged the same change during the run.
    const logged = (type: string, prefix: string, value: string) =>
      log.some((e) => e.type === type && e.time > before.takenAt && e.detail.startsWith(prefix) && e.detail.includes(`-> ${value}`));
    if (was.status !== now.status && !logged("status", "", now.status))
      store.appendEvent(slug, id, { by, type: "status", detail: `${was.status} -> ${now.status}${suffix}` });
    for (const f of store.TRACKED_FIELDS) {
      const a = was[f] || "none", b = now[f] || "none";
      if (a !== b && !logged("field", `${f}:`, b)) store.appendEvent(slug, id, { by, type: "field", detail: `${f}: ${a} -> ${b}${suffix}` });
    }
  }
  return after;
}

let tracked = 0;
let baseline: Baseline | undefined;

/** A task's Threads that still have a run record. */
const threadsOf = (slug: string, taskId: string, log?: ReturnType<typeof store.readTimeline>) =>
  store.threadsOf(slug, taskId, log).flatMap((t) => (t.run ? [{ ...t, run: t.run }] : []));

/** A Thread signs with its address; every other session that edits data files signs as claude. */
const author = (m: RunMeta) =>
  m.kind !== "task" ? "claude" : threadsOf(m.project!, m.taskId!).find((t) => t.run.id === m.id)?.address ?? "agent";

/** The Shuttle signs its own changes; shell commands edit no task. */
const isTracked = (m: RunMeta) => !m.spec.shell && m.kind !== "shuttle";

/** Every start and resume. Overlapping runs share one baseline, so their changes cannot be pinned on a specific run. */
function runStarted(m: RunMeta) {
  track({ src: "server", ev: "run.start", run: m.id, kind: m.kind, project: m.project, taskId: m.taskId });
  if (isTracked(m) && tracked++ === 0) baseline = snapshotTasks();
}

/** Every finish, resumes included: logs what changed in the tasks, and a Thread's finish with what it wrote. */
function runFinished(m: RunMeta, lines: Record<string, any>[]) {
  track({
    src: "server", ev: "run.end", run: m.id, kind: m.kind, project: m.project, taskId: m.taskId,
    status: m.status, turns: m.turns, costUsd: m.costUsd, peakContext: m.peakContext,
  });
  if (!isTracked(m)) return;
  const by = author(m);
  const alone = --tracked === 0;
  try {
    if (baseline) baseline = recordChanges(baseline, by, alone ? m.id : undefined);
  } finally {
    if (alone) baseline = undefined;
  }
  if (m.kind !== "task" || !m.project || !m.taskId || !store.readTask(m.project, m.taskId)) return;
  // What it wrote, from the edits it made in the project: tasks/T-006.log.md is T-006, memory/x.md is x.
  const dir = store.projectDir(m.project) + sep;
  const written = new Set<string>();
  for (const l of lines) {
    for (const c of l.type === "assistant" && Array.isArray(l.message?.content) ? l.message.content : []) {
      const file = String(c?.input?.file_path ?? c?.input?.notebook_path ?? "");
      if (c?.type !== "tool_use" || !/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(c.name) || !file.startsWith(dir)) continue;
      const [folder, name = ""] = file.slice(dir.length).split(sep);
      written.add(folder === "artifacts" ? name : name.replace(/(\.log)?\.md$/, ""));
    }
  }
  for (const generated of ["", "MEMORY"]) written.delete(generated);
  const detail = `${m.status}${written.size ? ` · wrote ${[...written].join(", ")}` : ""} · run ${m.id}`;
  store.appendEvent(m.project, m.taskId, { by, type: "run", detail });
}

// ---------- actions ----------

const firstLine = (text: string, n: number) => (text.trim().split("\n")[0] ?? "").trim().slice(0, n);

function readerSpec(cfg: Config, cwd: string): RunSpec {
  return {
    cwd,
    permissionMode: cfg.reader.permissionMode,
    allowedTools: cfg.reader.allowedTools,
    disallowedTools: cfg.reader.disallowedTools,
    ...(cfg.reader.model ? { model: cfg.reader.model } : {}),
  };
}

function readableProject(slug: string) {
  if (!existsSync(store.projectDir(slug))) bad("no such project", 404);
  const p = store.readProject(slug);
  if (p.error) bad(p.error, 409);
  return p;
}

/** One run at a time per automation: starting it again returns the run in progress. */
async function runAutomation(a: Automation): Promise<RunMeta> {
  const p = a.project ? readableProject(a.project) : undefined;
  const existing = findLiveRun((m) => m.kind === "automation" && m.title === a.name);
  if (existing) return existing;
  const init: RunInit = { kind: "automation", title: a.name, ...(p ? { project: p.slug } : {}) };
  const cwd = p ? store.projectDir(p.slug) : DATA;
  if (a.kind === "command") return startRun(init, { cwd, shell: true, permissionMode: "", allowedTools: [] }, a.run);
  const cfg = store.loadConfig();
  return startRun(init, readerSpec(cfg, cwd), automationPrompt(cfg, a.run, p));
}

const needText = (v: unknown, what = "text"): string =>
  typeof v === "string" && v.trim() ? v.trim() : bad(`${what} must not be empty`);

async function ingest(textIn: unknown, slugIn?: unknown): Promise<RunMeta> {
  const text = needText(textIn);
  const p = slugIn ? readableProject(store.checkSlug(slugIn)) : undefined;
  // The original is on disk before anything else can fail.
  const file = store.saveInbox(text);
  const cfg = store.loadConfig();
  return startRun(
    { kind: "ingest", title: `Ingest: ${firstLine(text, 60)}`, ...(p ? { project: p.slug } : {}) },
    readerSpec(cfg, DATA), ingestPrompt(cfg, text, p),
    (m) => {
      if (m.status === "done") store.archiveInbox(file);
    },
  );
}

async function ask(slug: string, textIn: unknown): Promise<RunMeta> {
  const text = needText(textIn);
  readableProject(slug);
  const cfg = store.loadConfig();
  const p = readableProject(slug);
  return startRun({ kind: "ask", title: firstLine(text, 70), project: slug }, readerSpec(cfg, store.projectDir(slug)), askPrompt(cfg, p, text));
}

async function generateArtifact(slug: string, textIn: unknown, taskIdIn?: unknown): Promise<RunMeta> {
  const text = needText(textIn);
  readableProject(slug);
  const taskId = taskIdIn ? store.checkTaskId(taskIdIn) : undefined;
  if (taskId && !store.readTask(slug, taskId)) bad(`task ${taskId} does not exist`);
  const cfg = store.loadConfig();
  const p = readableProject(slug);
  const tasks = store.listTasks(slug);
  const task = taskId ? tasks.find((t) => t.id === taskId) : undefined;
  return startRun(
    { kind: "artifact", title: `Document: ${firstLine(text, 60)}`, project: slug, ...(task ? { taskId: task.id } : {}) },
    readerSpec(cfg, store.projectDir(slug)),
    artifactPrompt(cfg, p, text, task, task ? store.ancestorsOf(tasks, task.id) : []),
  );
}

function delegate(slug: string, taskId: string, body: { repoPath?: unknown; instructions?: unknown; worktree?: unknown }): RunMeta {
  const p = readableProject(slug);
  const tasks = store.listTasks(slug);
  const task = tasks.find((t) => t.id === taskId) ?? bad("no such task", 404);
  const repoPath = store.checkRepoPath(body.repoPath);
  const cfg = store.loadConfig();
  const wantWorktree = typeof body.worktree === "boolean" ? body.worktree : cfg.agent.useWorktree;
  const useWorktree = wantWorktree && existsSync(join(repoPath, ".git"));
  const instructions = typeof body.instructions === "string" ? body.instructions : undefined;

  const spec: RunSpec = {
    cwd: repoPath,
    addDirs: [store.projectDir(slug)],
    pluginDirs: [join(import.meta.dir, "..", "plugins", "thread")],
    permissionMode: cfg.agent.permissionMode,
    allowedTools: cfg.agent.allowedTools,
    ...(cfg.agent.model ? { model: cfg.agent.model } : {}),
    ...(useWorktree ? { worktree: `dash-${taskId.toLowerCase()}-${store.randomId(4)}` } : {}),
  };
  const prompt = taskPrompt({
    project: p, task, instructions, worktree: useWorktree,
    ancestors: store.ancestorsOf(tasks, taskId),
    siblings: task.parent ? tasks.filter((t) => t.parent === task.parent && t.id !== taskId) : [],
  });
  const purpose = instructions ? firstLine(instructions, 200) : undefined;
  const run = startRun({ kind: "task", title: `${taskId}: ${task.title}`, project: slug, taskId, ...(purpose ? { purpose } : {}) }, spec, prompt);
  const repo = p.repos.find((r) => r.path === repoPath);
  const patched = store.patchTask(slug, taskId, { status: "in-progress", run: run.id, ...(repo ? { repo: repo.name } : {}) }, "me");
  store.appendEvent(slug, taskId, { by: "me", type: "run", detail: `started in ${repo?.name ?? repoPath} · run ${run.id}` });
  // The owner's own change is already logged; keep it out of the run's diff.
  baseline?.tasks.set(`${slug}/${taskId}`, {
    status: patched.status, priority: patched.priority, due: patched.due, title: patched.title, repo: patched.repo, parent: patched.parent,
  });
  return run;
}

/**
 * A note goes on the task's timeline first, then into every running Thread of the task, or the one
 * it names, at its next step. Only the owner's note starts a session: it resumes the latest ended
 * Thread while its cache is warm, and starts the next Thread in the same directory when it is cold.
 */
function note(slug: string, taskId: string, body: { text?: unknown; thread?: unknown }, owner: boolean): { delivered: number; run?: RunMeta } {
  if (!store.readTask(slug, taskId)) bad("no such task", 404);
  const text = needText(body.text);
  if (!owner && text.split(/\s+/).length > 100) bad("a note is at most 100 words; name a file for the rest");
  const thread = typeof body.thread === "string" && body.thread ? body.thread : undefined;
  const threads = threadsOf(slug, taskId).filter((t) => !thread || t.address === thread);
  if (thread && !threads.length) bad(`no Thread ${thread} on this task`, 404);
  const by = owner ? "me" : "agent";
  store.appendEvent(slug, taskId, { by, type: "note", detail: thread ?? "", body: text });
  const delivered = threads.filter((t) => sendNote(t.run.id, noteText(by, text))).length;
  const last = threads.at(-1);
  if (delivered || !owner || !last || last.run.status === "queued" || last.run.status === "running") return { delivered };
  // The note is on the timeline after the Thread's last result, so the resume or the brief carries it.
  if (last.run.endedAt && Date.now() - Date.parse(last.run.endedAt) < CACHE_COLD_MS && last.run.sessionId)
    return { delivered: 1, run: sendMessage(last.run.id, "") };
  const run = delegate(slug, taskId, {
    repoPath: last.run.sessionCwd ?? last.run.spec.cwd, worktree: false,
    instructions: `You continue ${last.address} in its working directory and branch. Check the directory and git history before repeating anything.`,
  });
  return { delivered: 1, run };
}

const indent = (text: string) => text.split("\n").map((l) => `  ${l}`);
const cut = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text);

/**
 * Unblock: back to in-progress if the task has had a Thread, else todo. On a task a Thread blocked,
 * Unblock is Continue: the owner's note carries on the work (threads/states.md).
 */
function unblock(slug: string, taskId: string, text: unknown, owner: boolean) {
  if (store.readTask(slug, taskId)?.status !== "blocked") bad("the task is not blocked", 409);
  const by = store.readTimeline(slug, taskId).findLast((e) => e.type === "status" && /-> blocked\b/.test(e.detail))?.by ?? "";
  const words = typeof text === "string" ? text.trim() : "";
  const hadThread = threadsOf(slug, taskId).length > 0;
  if (!/^T-\d+\.\d+$/.test(by)) return store.patchTask(slug, taskId, { status: hadThread ? "in-progress" : "todo", comment: words }, "me");
  store.patchTask(slug, taskId, { status: "in-progress" }, "me");
  return note(slug, taskId, { text: words || "Continue from where you stopped; check the directory and git history first." }, owner);
}

/**
 * The Threads board, a view over task status and Thread state in four groups (threads/states.md):
 * waiting on human (blocked on a human, and review), working (a live Thread, one row each), ready
 * (todo, not blocked) and waiting on task. By priority, then due date. Derived on every call.
 */
function board(): BoardRow[] {
  const rows: BoardRow[] = [];
  const all = store.listProjectSlugs().flatMap((slug) => {
    const tasks = store.listTasks(slug);
    return tasks.filter((t) => t.id !== "T-000" && !isClosed(t.status)).map((t) => ({ slug, t, tasks }));
  });
  all.sort((a, b) => a.t.priority.localeCompare(b.t.priority) || (a.t.due ?? "9999").localeCompare(b.t.due ?? "9999"));
  for (const { slug, t, tasks } of all) {
    const log = store.readTimeline(slug, t.id);
    const threads = threadsOf(slug, t.id, log);
    const block = store.blockOf(slug, t, tasks, log, threads);
    const last = threads.at(-1);
    const row = { project: slug, taskId: t.id, title: t.title, ...(last ? { address: last.address, runId: last.run.id } : {}) };
    const working = threads.filter(({ run }) => run.status === "running" || run.status === "queued");
    for (const { address, run } of working) {
      const detail = run.status === "running" ? `${run.turns} turns · ${compact(run.peakContext ?? 0)} context` : "waiting for a free slot";
      rows.push({ ...row, group: "Working", state: run.status as "running" | "queued", detail, address, runId: run.id });
    }
    if (block?.on === "human") rows.push({ ...row, group: "Waiting on human", state: block.state, detail: block.detail });
    else if (t.status === "review") {
      const report = firstLine(log.findLast((e) => e.type === "comment")?.body.replace(/^#.*$/gm, "") ?? "", 160);
      rows.push({ ...row, group: "Waiting on human", state: "review", detail: report });
    } else if (working.length) continue;
    else if (block) rows.push({ ...row, group: "Waiting on task", state: "blocked", detail: block.detail });
    else if (t.status === "todo") rows.push({ ...row, group: "Ready", state: "todo", detail: firstLine(t.excerpt, 160) });
  }
  return rows.sort((a, b) => BOARD_GROUPS.indexOf(a.group) - BOARD_GROUPS.indexOf(b.group));
}

/** Open work for the Shuttle: the board, one line per task, those needing the owner first, capped. */
function ledger(): string[] {
  const tasks = new Map<string, BoardRow[]>();
  for (const r of board()) tasks.set(`${r.project}/${r.taskId}`, [...(tasks.get(`${r.project}/${r.taskId}`) ?? []), r]);
  const lines = [...tasks.values()].map((rows) => {
    const states = rows.map((r) => `${r.address ? `${r.address} ` : ""}${r.state}${r.detail ? ` "${cut(r.detail, 100)}"` : ""}`);
    return `${rows[0]!.taskId} ${rows[0]!.project} "${rows[0]!.title}" · ${states.join("; ")}`;
  });
  return lines.length > 20 ? [...lines.slice(0, 19), `…and ${lines.length - 19} more on the board`] : lines;
}

/**
 * The past Shuttle sessions, newest first, each with the owner's first message and the tasks it
 * signed on their timelines. With SHUTTLE.md this is the Shuttle's memory; nothing is summarised.
 */
function writeShuttleSessions() {
  const signed: { time: string; task: string }[] = [];
  for (const slug of store.listProjectSlugs()) {
    for (const id of store.listTaskIds(slug)) {
      for (const e of store.readTimeline(slug, id)) if (e.by === "shuttle") signed.push({ time: e.time, task: `${slug}/${id}` });
    }
  }
  const lines = listRuns().filter((r) => r.kind === "shuttle").slice(0, 50).map((r) => {
    const end = r.endedAt ?? store.nowIso();
    const wrote = [...new Set(signed.filter((e) => e.time >= r.createdAt && e.time <= end).map((e) => e.task))];
    return `shuttle@${r.createdAt.slice(0, 16)}  "${r.title.replace(/^Shuttle: /, "")}"  wrote ${wrote.join(", ") || "nothing"}`;
  });
  store.writeAtomic(join(DATA, "SESSIONS.md"), `# Shuttle sessions\n\nGenerated by Loom, newest first: when each began, the owner's first message, the tasks it wrote.\n\n${lines.join("\n")}\n`);
}

/**
 * The Shuttle is a run resumed message by message while its prompt cache is warm. A message after
 * an idle hour starts a fresh session instead, opened with a hand-over that code writes from the
 * files: standing instructions, open work and the last exchanges (rules R2 and R3).
 */
function talkToShuttle(textIn: unknown, fresh: unknown): RunMeta {
  const text = needText(textIn);
  const cfg = store.loadConfig();
  const last = getRun(store.loadState().shuttle ?? "");
  if (last && (last.status === "queued" || last.status === "running")) bad("the Shuttle is still answering", 409);
  writeShuttleSessions();
  const cold = !last?.endedAt || Date.now() - Date.parse(last.endedAt) > CACHE_COLD_MS;
  if (last?.sessionId && fresh !== true && !cold) {
    const ended = listRuns().filter((r) => r.kind !== "shuttle" && r.endedAt && r.endedAt > (last.endedAt ?? ""));
    const news = ended.map((r) => `- run ${r.id} (${r.kind}, "${r.title}") ${r.status}${r.error ? `: ${firstLine(r.error, 200)}` : ""}`);
    return sendMessage(last.id, [...(news.length ? ["Since your last reply these runs ended:", ...news] : []), "---", text].join("\n"));
  }

  const notebook = (store.readText(join(DATA, "SHUTTLE.md")) ?? "").trim().split("\n").slice(0, 40).join("\n");
  const exchanges: { me: string; shuttle: string }[] = [];
  for (const l of last ? readTranscript(last.id) : []) {
    if (l.type === "dash_prompt" || l.type === "dash_user") exchanges.push({ me: ownerText(String(l.text ?? "")), shuttle: "" });
    else if (l.type === "result" && exchanges.length) exchanges[exchanges.length - 1]!.shuttle = String(l.result ?? "");
  }
  const work = ledger();
  const earlier = exchanges.slice(-3).flatMap((x) => [...indent(`me: ${cut(x.me, 600)}`), ...indent(`Shuttle: ${cut(x.shuttle, 600)}`)]);
  // Every context line is indented, so the first bare "---" line is where the owner's words start.
  const envelope = [
    `Loom: ${store.nowIso()}`,
    ...(notebook ? ["Standing instructions (SHUTTLE.md):", ...indent(notebook)] : []),
    "Open work:", ...(work.length ? indent(work.join("\n")) : ["  none"]),
    ...(earlier.length ? ["The last exchanges before this conversation, verbatim:", ...earlier] : []),
    "---", text,
  ].join("\n");

  const api = `http://127.0.0.1:${PORT}`;
  // The method comes before the URL, so a rule cannot match a route it does not name (POST .../delegate
  // under GET .../tasks/*). A wildcard can still be abused; the server's own checks are the hard stop.
  const routes = SHUTTLE_ROUTES.map(([, method, path, body]) => `Bash(curl -s -X ${method} ${api}${path.replace(/<[^>]+>/g, "*")}${body ? " *" : ""})`);
  const spec: RunSpec = {
    cwd: DATA,
    // Anything not allowed below is refused: it reads files and changes them only through its routes (ADR 0026).
    permissionMode: "default",
    // Links go to ingest runs, so the Shuttle never reads the web.
    allowedTools: ["Read", "Glob", "Grep", ...routes],
    systemPrompt: shuttlePrompt(cfg, api),
    ...(cfg.reader.model ? { model: cfg.reader.model } : {}),
  };
  const run = startRun({ kind: "shuttle", title: `Shuttle: ${firstLine(text, 100)}` }, spec, envelope);
  store.saveState({ shuttle: run.id });
  return run;
}

// ---------- daily schedule ----------

const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** Records that an automation's daily run is settled for today, so the tick leaves it until tomorrow. */
const markRan = (id: string) => store.saveState({ automationRan: { ...store.loadState().automationRan, [id]: store.today() } });

/** Checked every minute, so a machine that slept through an automation's time still runs it, once per day. */
function scheduleTick() {
  void pushIfDue().catch((e) => console.error("backup push:", (e as Error).message));
  try {
    for (const a of store.listAutomations()) {
      if (!a.enabled || !a.time || hhmm() < a.time || store.loadState().automationRan?.[a.id] === store.today()) continue;
      // Recorded before dispatch: a crash here skips the day rather than repeating it.
      markRan(a.id);
      void runAutomation(a).catch((e) => console.error(`automation ${a.name}:`, (e as Error).message));
    }
  } catch (e) {
    console.error("schedule:", (e as Error).message);
  }
}

/** An automation saved after its time of day waits for tomorrow instead of firing at the next tick. */
function saveAutomation(id: string | undefined, input: Record<string, unknown>): Automation {
  const a = store.saveAutomation(id, input);
  if (a.time && a.time <= hhmm()) markRan(a.id);
  return a;
}

// ---------- reads ----------

const summary = ({ body: _body, ...t }: Task): TaskSummary => t;

function snapshot(): Snapshot {
  return {
    dataDir: DATA,
    config: store.loadConfig(),
    automations: store.listAutomations(),
    lastBackupPush: store.loadState().lastBackupPush,
    shuttle: getRun(store.loadState().shuttle ?? ""),
    // The root task T-000 is the project itself, so it is the project here, not one of its tasks.
    projects: store.listProjectSlugs().map((slug) => ({
      ...store.readProject(slug),
      tasks: store.listTasks(slug).filter((t) => t.id !== "T-000").map(summary),
    })),
    runs: listRuns(150),
    board: board(),
  };
}

function taskDetail(slug: string, id: string): TaskDetail {
  const tasks = store.listTasks(slug);
  const task = tasks.find((t) => t.id === id) ?? bad("no such task", 404);
  const artifacts = store.listArtifacts(slug);
  return {
    task,
    timeline: store.readTimeline(slug, id),
    ancestors: store.ancestorsOf(tasks, id).reverse().map((a) => ({
      id: a.id, title: a.title, status: a.status,
      context: store.extractSection(a.body, "Context"),
      artifacts: artifacts.filter((x) => x.task === a.id),
    })),
    // A task with no parent is part of its project's root task, T-000.
    children: tasks.filter((t) => t.parent === id || (id === "T-000" && !t.parent && t.id !== id)).map(summary),
    artifacts: artifacts.filter((a) => a.task === id),
    runs: listRuns().filter((r) => r.project === slug && r.taskId === id),
    linkedFrom: store.projectGraph(slug).edges
      .filter((e) => e.rel === "mentions" && (e.to === id || e.to.startsWith(`${id}#`) || e.to.startsWith(`${id}.`)))
      .map((e) => ({ from: e.from, line: e.line ?? "" })),
  };
}

// ---------- http ----------

const json = (data: unknown, status = 200) => Response.json(data, { status });

// Marks the dashboard page's notes and Starts as the owner's. Held in memory only, and handed to a
// browser page, never to curl: it stops an agent being mislabelled, not a deliberate forgery.
const OWNER_TOKEN = crypto.randomUUID();
const isOwner = (req: Request) => req.headers.get("x-loom-owner") === OWNER_TOKEN;
const LOCAL_HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`];

/** Loopback Host, a local Origin when one is sent, and JSON for anything that mutates. */
function gate(req: Request): Response | undefined {
  if (!LOCAL_HOSTS.includes((req.headers.get("host") ?? "").toLowerCase())) return json({ error: "forbidden host" }, 403);
  const origin = req.headers.get("origin");
  // A sandboxed artifact has the opaque origin "null" and lands here.
  if (origin !== null && !LOCAL_HOSTS.some((h) => origin.toLowerCase() === `http://${h}`)) return json({ error: "forbidden origin" }, 403);
  if (req.method !== "GET" && req.method !== "HEAD") {
    const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/json") return json({ error: "mutations must be application/json" }, 415);
  }
  return undefined;
}

async function readBody(req: Request): Promise<Record<string, any>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return bad("the body must be JSON");
  }
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, any>) : bad("the body must be a JSON object");
}

async function api(req: Request, url: URL): Promise<Response> {
  let seg: string[];
  try {
    seg = url.pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent);
  } catch {
    return bad("malformed path");
  }
  const m = req.method;
  const is = (method: string, ...pattern: (string | null)[]) =>
    m === method && seg.length === pattern.length && pattern.every((p, i) => p === null || p === seg[i]);
  // An agent's curl allow rule can be bent to reach any route, so the server keeps these for the owner (ADR 0026).
  if ((m === "DELETE" || is("PUT", "config") || is("POST", "automations") || is("PUT", "automations", null)) && !isOwner(req))
    bad("only the owner can do that", 403);
  // The Shuttle is the only other caller of the task routes; Threads write their files (ADR 0026).
  const by = isOwner(req) ? "me" : "shuttle";

  if (is("GET", "state")) return json(snapshot());
  if (is("GET", "events"))
    return sse(req, (send) => {
      listeners.add(send);
      send("data: hello\n\n");
      return () => listeners.delete(send);
    });

  if (is("GET", "usage")) return json(usageRows(listRuns()));
  if (is("GET", "telemetry")) return json(readTelemetry());
  // The dashboard's views and clicks, batched. The server's clock decides the day.
  if (is("POST", "telemetry")) {
    const events: Record<string, any>[] = (await readBody(req)).events;
    if (!Array.isArray(events)) bad("events must be a list");
    track(...events.filter((e) => e && (e.ev === "view" || e.ev === "click")).map(({ t: _, ...e }) => ({ ...e, src: "web" })));
    return json({ ok: true });
  }
  if (is("GET", "owner"))
    return req.headers.get("sec-fetch-site") === "same-origin" ? json({ token: OWNER_TOKEN }) : bad("the owner's token goes only to the dashboard page", 403);

  if (is("GET", "config")) return json(store.loadConfig());
  if (is("PUT", "config")) return json(store.saveConfig(await readBody(req)));

  if (is("POST", "ingest")) {
    const b = await readBody(req);
    return json(await ingest(b.text, b.project));
  }

  if (is("PUT", "shuttle", "notebook")) {
    const text = needText((await readBody(req)).text);
    if (text.split("\n").length > 40) bad("the notebook is at most 40 lines");
    store.writeAtomic(join(DATA, "SHUTTLE.md"), text + "\n");
    return json({ ok: true });
  }
  if (is("POST", "shuttle")) {
    const b = await readBody(req);
    return json(talkToShuttle(b.text, b.fresh));
  }

  if (is("POST", "automations")) return json(saveAutomation(undefined, await readBody(req)));
  if (is("PUT", "automations", null)) return json(saveAutomation(seg[1], await readBody(req)));
  if (is("DELETE", "automations", null)) return store.deleteAutomation(seg[1]!), json({ ok: true });
  if (is("POST", "automations", null, "run"))
    return json(await runAutomation(store.listAutomations().find((a) => a.id === seg[1]) ?? bad("no such automation", 404)));

  if (seg[0] === "runs" && seg[1]) {
    const run = getRun(seg[1]) ?? bad("no such run", 404);
    if (is("GET", "runs", null)) return json(run);
    if (is("GET", "runs", null, "stream"))
      return sse(req, (send, close) =>
        subscribe(run.id, (line) => {
          if (line) return send(`data: ${JSON.stringify(line)}\n\n`);
          send("event: end\ndata: {}\n\n");
          close();
        }),
      );
    if (is("POST", "runs", null, "stop")) {
      if (!stopRun(run.id)) bad("the run is not in progress", 409);
      return json({ ok: true });
    }
    if (is("POST", "runs", null, "message")) {
      const text = needText((await readBody(req)).text);
      try {
        return json(sendMessage(run.id, text));
      } catch (e) {
        return bad((e as Error).message, 409);
      }
    }
  }

  if (is("POST", "projects")) return json(store.createProject(needText((await readBody(req)).name, "name")));

  if (seg[0] === "projects" && seg[1]) {
    const slug = store.checkSlug(seg[1]);
    if (!existsSync(store.projectDir(slug))) bad("no such project", 404);
    const P = (method: string, ...pattern: (string | null)[]) => is(method, "projects", null, ...pattern);

    if (P("PATCH")) return json(store.patchProject(slug, await readBody(req)));
    if (P("DELETE")) return store.deleteProject(slug), json({ ok: true });
    if (P("GET", "graph")) return json(store.projectGraph(slug));
    if (P("POST", "ask")) return json(await ask(slug, (await readBody(req)).text));

    if (P("POST", "sources")) {
      const b = await readBody(req);
      return json(store.addSource(slug, b.url, b.title));
    }
    if (P("DELETE", "sources", null)) return json(store.removeSource(slug, seg[3]!));
    if (P("POST", "repos")) {
      const b = await readBody(req);
      return json(store.addRepo(slug, b.path, b.name));
    }
    if (P("DELETE", "repos", null)) return json(store.removeRepo(slug, seg[3]!));

    if (P("POST", "tasks")) return json(store.createTask(slug, await readBody(req), by));
    if (seg[2] === "tasks" && seg[3]) {
      const id = store.checkTaskId(seg[3]);
      if (P("GET", "tasks", null)) return json(taskDetail(slug, id));
      if (P("PATCH", "tasks", null)) return json(store.patchTask(slug, id, await readBody(req), by));
      if (P("DELETE", "tasks", null)) return store.deleteTask(slug, id), json({ ok: true });
      if (P("POST", "tasks", null, "comments")) {
        const b = await readBody(req);
        if (!store.readTask(slug, id)) bad("no such task", 404);
        const text = typeof b.text === "string" ? b.text.trim() : "";
        if (!text && !b.done) bad("text must not be empty");
        if (text) store.appendEvent(slug, id, { by, type: "comment", body: text });
        if (b.done) store.patchTask(slug, id, { status: "done" }, by);
        return json({ ok: true });
      }
      if (P("POST", "tasks", null, "checklist")) {
        const b = await readBody(req);
        if (!Number.isInteger(b.index) || typeof b.checked !== "boolean") bad("index and checked are required");
        return json(store.toggleChecklist(slug, id, b.index, b.checked));
      }
      if (P("POST", "tasks", null, "note")) return json(note(slug, id, await readBody(req), isOwner(req)));
      if (P("POST", "tasks", null, "unblock")) return json(unblock(slug, id, (await readBody(req)).text, isOwner(req)));
      if (P("POST", "tasks", null, "delegate")) {
        if (!isOwner(req)) bad("only the owner starts a Thread", 403);
        return json(delegate(slug, id, await readBody(req)));
      }
    }

    if (P("GET", "artifacts")) return json(store.listArtifacts(slug));
    if (P("POST", "artifacts")) return json(store.createArtifact(slug, await readBody(req)));
    if (P("POST", "artifacts", "generate")) {
      const b = await readBody(req);
      return json(await generateArtifact(slug, b.text, b.taskId));
    }
    if (P("GET", "artifacts", null)) return json(store.readArtifact(slug, seg[3]!));
    if (P("PUT", "artifacts", null)) return json(store.writeArtifact(slug, seg[3]!, (await readBody(req)).content));
    if (P("DELETE", "artifacts", null)) return store.deleteArtifact(slug, seg[3]!), json({ ok: true });
    if (P("GET", "artifacts", null, "raw")) {
      const a = store.readArtifact(slug, seg[3]!);
      // Untrusted HTML: an opaque origin wherever it is opened, and no content sniffing.
      return new Response(a.content, {
        headers: {
          "Content-Type": a.kind === "html" && url.searchParams.get("view") !== "source" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
          "Content-Security-Policy": "sandbox allow-scripts",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    }

    if (P("GET", "memory")) return json(store.listMemory(slug));
    if (P("POST", "memory")) return json(store.saveMemory(slug, undefined, await readBody(req)));
    if (P("PUT", "memory", null)) return json(store.saveMemory(slug, seg[3]!, await readBody(req)));
    if (P("DELETE", "memory", null)) return store.deleteMemory(slug, seg[3]!), json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}

// ---------- startup ----------

store.initStorage();
initRuns(notify, { started: runStarted, finished: runFinished });
// After the run records, so a Thread that died with the last server shows as interrupted.
for (const slug of store.listProjectSlugs()) store.writeGraph(slug);
await initBackup(hasLiveRuns);
setTimeout(scheduleTick, 5_000);
setInterval(scheduleTick, 60_000);
startWatcher();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  development: !PROD,
  routes: { "/": index },
  async fetch(req) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    const refused = gate(req);
    if (refused) return refused;
    const start = performance.now();
    let res: Response;
    try {
      res = await api(req, url);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(`${req.method} ${url.pathname}:`, e);
      res = e instanceof HttpError ? json({ error: e.message }, e.status)
        : json({ error: PROD ? "internal error" : String((e as Error)?.stack ?? e) }, 500);
    }
    if (req.method !== "GET" && url.pathname !== "/api/telemetry")
      track({
        src: "server", ev: "api", method: req.method, path: url.pathname, status: res.status,
        ms: Math.round(performance.now() - start), actor: isOwner(req) ? "owner" : "agent", len: Number(req.headers.get("content-length") ?? 0),
      });
    return res;
  },
});

console.log(`Loom is running at http://127.0.0.1:${PORT}  (data: ${DATA})`);
