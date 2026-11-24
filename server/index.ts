// Routing, actions, automations and the watcher.

import { existsSync, watch } from "node:fs";
import { join, sep } from "node:path";
import index from "../web/index.html";
import { initBackup, pushIfDue, scheduleBackup } from "./backup";
import { artifactPrompt, askPrompt, automationPrompt, gatewayTools, ingestPrompt, setupPrompt, shuttlePrompt, taskPrompt } from "./prompts";
import { findLiveRun, getRun, hasLiveRuns, initRuns, listRuns, sendMessage, startRun, stopRun, subscribe, type RunInit } from "./runs";
import * as store from "./store";
import { DATA, HttpError } from "./store";
import { usageRows } from "./usage";
import type { Automation, Config, RunMeta, RunSpec, Snapshot, Task, TaskDetail, TaskSummary } from "./types";

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

const memoryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function startWatcher() {
  watch(DATA, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const parts = String(filename).split(sep);
    const name = parts[parts.length - 1]!;
    // Run records, git internals and temporary write files are not data changes.
    if (parts[0] === "runs" || parts[0] === ".git" || name.includes(".tmp-") || name === "server.log" || name === ".DS_Store") return;
    notify();
    scheduleBackup();
    if (parts[0] === "projects" && parts[2] === "memory" && name !== "MEMORY.md" && store.isSlug(parts[1])) {
      const slug = parts[1]!;
      clearTimeout(memoryTimers.get(slug));
      memoryTimers.set(slug, setTimeout(() => {
        memoryTimers.delete(slug);
        try {
          store.rebuildMemoryIndex(slug);
        } catch (e) {
          console.error(`memory index for ${slug}:`, (e as Error).message);
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

/** Overlapping runs share one baseline, so their changes cannot be pinned on a specific run. */
function startTracked(init: RunInit, spec: RunSpec, prompt: string, by: string, hook?: (m: RunMeta) => void): RunMeta {
  if (tracked++ === 0) baseline = snapshotTasks();
  return startRun(init, spec, prompt, (m) => {
    const alone = --tracked === 0;
    try {
      baseline = recordChanges(baseline!, by, alone ? m.id : undefined);
    } finally {
      if (alone) baseline = undefined;
      hook?.(m);
    }
  });
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

let connectorSetup: Promise<void> | undefined;

/**
 * Some MCP gateways keep their backends off in headless sessions until enabled, and enabling only
 * takes effect in the next session. Runs once per connector list; concurrent callers share it.
 */
function ensureConnectors(): Promise<void> {
  const cfg = store.loadConfig();
  const wanted = cfg.connectors.join(",");
  if (!wanted || !cfg.connectorGateway || store.loadState().connectors === wanted) return Promise.resolve();
  connectorSetup ??= new Promise<void>((resolve) => {
    const { list, enable } = gatewayTools(cfg);
    startRun(
      { kind: "setup", title: "Enable connectors" },
      { cwd: DATA, permissionMode: cfg.reader.permissionMode, allowedTools: ["ToolSearch", list, enable], disallowedTools: ["Bash"] },
      setupPrompt(cfg),
      (m) => {
        if (m.status === "done") store.saveState({ connectors: wanted });
        resolve();
      },
    );
  }).finally(() => (connectorSetup = undefined));
  return connectorSetup;
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
  await ensureConnectors();
  const cfg = store.loadConfig();
  return startTracked(init, readerSpec(cfg, cwd), automationPrompt(cfg, a.run, p), "claude");
}

const needText = (v: unknown, what = "text"): string =>
  typeof v === "string" && v.trim() ? v.trim() : bad(`${what} must not be empty`);

async function ingest(textIn: unknown, slugIn?: unknown): Promise<RunMeta> {
  const text = needText(textIn);
  const p = slugIn ? readableProject(store.checkSlug(slugIn)) : undefined;
  // The original is on disk before anything else can fail.
  const file = store.saveInbox(text);
  await ensureConnectors();
  const cfg = store.loadConfig();
  return startTracked(
    { kind: "ingest", title: `Ingest: ${firstLine(text, 60)}`, ...(p ? { project: p.slug } : {}) },
    readerSpec(cfg, DATA), ingestPrompt(cfg, text, p), "claude",
    (m) => {
      if (m.status === "done") store.archiveInbox(file);
    },
  );
}

async function ask(slug: string, textIn: unknown): Promise<RunMeta> {
  const text = needText(textIn);
  readableProject(slug);
  await ensureConnectors();
  const cfg = store.loadConfig();
  const p = readableProject(slug);
  return startTracked({ kind: "ask", title: firstLine(text, 70), project: slug }, readerSpec(cfg, store.projectDir(slug)), askPrompt(cfg, p, text), "claude");
}

async function generateArtifact(slug: string, textIn: unknown, taskIdIn?: unknown): Promise<RunMeta> {
  const text = needText(textIn);
  readableProject(slug);
  const taskId = taskIdIn ? store.checkTaskId(taskIdIn) : undefined;
  if (taskId && !store.readTask(slug, taskId)) bad(`task ${taskId} does not exist`);
  await ensureConnectors();
  const cfg = store.loadConfig();
  const p = readableProject(slug);
  const tasks = store.listTasks(slug);
  const task = taskId ? tasks.find((t) => t.id === taskId) : undefined;
  return startTracked(
    { kind: "artifact", title: `Document: ${firstLine(text, 60)}`, project: slug, ...(task ? { taskId: task.id } : {}) },
    readerSpec(cfg, store.projectDir(slug)),
    artifactPrompt(cfg, p, text, task, task ? store.ancestorsOf(tasks, task.id) : []),
    "claude",
  );
}

function delegate(slug: string, taskId: string, body: { repoPath?: unknown; instructions?: unknown; worktree?: unknown }): RunMeta {
  const p = readableProject(slug);
  const tasks = store.listTasks(slug);
  const task = tasks.find((t) => t.id === taskId) ?? bad("no such task", 404);
  if (findLiveRun((m) => m.kind === "task" && m.project === slug && m.taskId === taskId))
    bad("an agent is already working on this task", 409);
  const repoPath = store.checkRepoPath(body.repoPath);
  const cfg = store.loadConfig();
  const wantWorktree = typeof body.worktree === "boolean" ? body.worktree : cfg.agent.useWorktree;
  const useWorktree = wantWorktree && existsSync(join(repoPath, ".git"));
  const instructions = typeof body.instructions === "string" ? body.instructions : undefined;

  const artifacts = store.listArtifacts(slug);
  const namesFor = (id: string) => artifacts.filter((a) => a.task === id).map((a) => a.name).sort();
  const ancestors = store.ancestorsOf(tasks, taskId);
  const spec: RunSpec = {
    cwd: repoPath,
    addDirs: [store.projectDir(slug)],
    permissionMode: cfg.agent.permissionMode,
    allowedTools: cfg.agent.allowedTools,
    ...(cfg.agent.model ? { model: cfg.agent.model } : {}),
    ...(useWorktree ? { worktree: `dash-${taskId.toLowerCase()}-${store.randomId(4)}` } : {}),
  };
  const prompt = taskPrompt({
    project: p, task, instructions, worktree: useWorktree,
    artifacts: namesFor(taskId),
    ancestors: ancestors.map((a) => ({ task: a, artifacts: namesFor(a.id) })),
    siblings: task.parent ? tasks.filter((t) => t.parent === task.parent && t.id !== taskId) : [],
  });
  const run = startTracked(
    { kind: "task", title: `${taskId}: ${task.title}`, project: slug, taskId }, spec, prompt, "agent",
    (m) => {
      if (store.readTask(slug, taskId)) store.appendEvent(slug, taskId, { by: "agent", type: "run", detail: `${m.status} · run ${m.id}` });
    },
  );
  const repo = p.repos.find((r) => r.path === repoPath);
  const patched = store.patchTask(slug, taskId, { status: "doing", run: run.id, ...(repo ? { repo: repo.name } : {}) }, "me");
  store.appendEvent(slug, taskId, { by: "me", type: "run", detail: `started in ${repo?.name ?? repoPath} · run ${run.id}` });
  // The owner's own change is already logged; keep it out of the run's diff.
  baseline?.tasks.set(`${slug}/${taskId}`, {
    status: patched.status, priority: patched.priority, due: patched.due, title: patched.title, repo: patched.repo, parent: patched.parent,
  });
  return run;
}

/**
 * The Shuttle is one long conversation: each message resumes the same session. Runs that ended since
 * its last reply ride along with the message, so workers report back without waking it on their own.
 */
function talkToShuttle(textIn: unknown, fresh: unknown): RunMeta {
  const text = needText(textIn);
  const cfg = store.loadConfig();
  const current = fresh === true ? undefined : getRun(store.loadState().shuttle ?? "");
  if (current && (current.status === "queued" || current.status === "running")) bad("the Shuttle is still answering", 409);
  if (current?.sessionId) {
    const ended = listRuns().filter((r) => r.kind !== "shuttle" && r.endedAt && r.endedAt > (current.endedAt ?? ""));
    const news = ended.map((r) => `- run ${r.id} (${r.kind}, "${r.title}") ${r.status}${r.error ? `: ${firstLine(r.error, 200)}` : ""}`);
    return sendMessage(current.id, news.length ? `${text}\n\n---\nLoom: since your last reply these runs ended:\n${news.join("\n")}` : text);
  }
  const spec: RunSpec = {
    cwd: DATA,
    permissionMode: cfg.reader.permissionMode,
    // Shell access is only Loom's own API; links go to ingest runs, so the Shuttle never reads the web.
    allowedTools: ["Read", "Glob", "Grep", "Edit", "Write", `Bash(curl -s http://127.0.0.1:${PORT}/api/*)`],
    systemPrompt: shuttlePrompt(cfg, `http://127.0.0.1:${PORT}`),
    ...(cfg.reader.model ? { model: cfg.reader.model } : {}),
  };
  const run = startRun({ kind: "shuttle", title: `Shuttle: ${firstLine(text, 60)}` }, spec, text);
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
    projects: store.listProjectSlugs().map((slug) => ({
      ...store.readProject(slug),
      tasks: store.listTasks(slug).map(summary),
    })),
    runs: listRuns(150),
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
    children: tasks.filter((t) => t.parent === id).map(summary),
    artifacts: artifacts.filter((a) => a.task === id),
    runs: listRuns().filter((r) => r.project === slug && r.taskId === id),
  };
}

// ---------- http ----------

const json = (data: unknown, status = 200) => Response.json(data, { status });
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

  if (is("GET", "state")) return json(snapshot());
  if (is("GET", "events"))
    return sse(req, (send) => {
      listeners.add(send);
      send("data: hello\n\n");
      return () => listeners.delete(send);
    });

  if (is("GET", "usage")) return json(usageRows(listRuns()));

  if (is("GET", "config")) return json(store.loadConfig());
  if (is("PUT", "config")) return json(store.saveConfig(await readBody(req)));

  if (is("POST", "ingest")) {
    const b = await readBody(req);
    return json(await ingest(b.text, b.project));
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

    if (P("POST", "tasks")) return json(store.createTask(slug, await readBody(req), "me"));
    if (seg[2] === "tasks" && seg[3]) {
      const id = store.checkTaskId(seg[3]);
      if (P("GET", "tasks", null)) return json(taskDetail(slug, id));
      if (P("PATCH", "tasks", null)) return json(store.patchTask(slug, id, await readBody(req), "me"));
      if (P("DELETE", "tasks", null)) return store.deleteTask(slug, id), json({ ok: true });
      if (P("POST", "tasks", null, "comments")) {
        const b = await readBody(req);
        if (!store.readTask(slug, id)) bad("no such task", 404);
        const text = typeof b.text === "string" ? b.text.trim() : "";
        if (!text && !b.done) bad("text must not be empty");
        if (text) store.appendEvent(slug, id, { by: "me", type: "comment", body: text });
        if (b.done) store.patchTask(slug, id, { status: "done" }, "me");
        return json({ ok: true });
      }
      if (P("POST", "tasks", null, "checklist")) {
        const b = await readBody(req);
        if (!Number.isInteger(b.index) || typeof b.checked !== "boolean") bad("index and checked are required");
        return json(store.toggleChecklist(slug, id, b.index, b.checked));
      }
      if (P("POST", "tasks", null, "delegate")) return json(delegate(slug, id, await readBody(req)));
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
initRuns(notify);
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
    try {
      return await api(req, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(`${req.method} ${url.pathname}:`, e);
      return json({ error: PROD ? "internal error" : String((e as Error)?.stack ?? e) }, 500);
    }
  },
});

console.log(`Loom is running at http://127.0.0.1:${PORT}  (data: ${DATA})`);
