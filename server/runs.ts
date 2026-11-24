// The run manager: spawns, queues, streams and resumes headless Claude Code sessions, and runs
// the shell commands of automations through the same queue.

import { appendFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, nowIso, randomId, readTimeline, runsDir, writeAtomic } from "./store";
import type { RunKind, RunMeta, RunSpec, RunStatus, RunUsage } from "./types";

export interface RunInit {
  kind: RunKind;
  title: string;
  purpose?: string;
  project?: string;
  taskId?: string;
}
type Line = Record<string, any>;
type Subscriber = (line: Line | null) => void;
type DoneHook = (meta: RunMeta) => void | Promise<void>;

interface Active {
  meta: RunMeta;
  lines: Line[];
  subs: Set<Subscriber>;
  /** Transcript appends are chained so they land in order. */
  writes: Promise<unknown>;
  /** Model calls of the main session already counted as turns. */
  calls: Set<string>;
  proc?: ReturnType<typeof Bun.spawn>;
  /** The session's input, open until its result; notes written before the session starts wait in `pending`. */
  input?: import("bun").FileSink;
  pending: string[];
  stopRequested?: boolean;
}
interface Job {
  id: string;
  prompt: string;
  resume: boolean;
}

const metas = new Map<string, RunMeta>();
const active = new Map<string, Active>();
const hooks = new Map<string, DoneHook>();
const queue: Job[] = [];
let onChange: () => void = () => {};
/** Called on every start and every resume of a session, and on every finish. */
let lifecycle: { started: (meta: RunMeta) => void; finished: (meta: RunMeta, lines: Line[]) => void } = { started() {}, finished() {} };

const metaFile = (id: string) => join(runsDir(), `${id}.json`);
const logFile = (id: string) => join(runsDir(), `${id}.jsonl`);
const isRunId = (id: string) => /^\d{14}-[a-z0-9]{4}$/.test(id);
const live = (s: RunStatus) => s === "queued" || s === "running";

function saveMeta(meta: RunMeta) {
  writeAtomic(metaFile(meta.id), JSON.stringify(meta, null, 2) + "\n");
  // runs/ is not watched, so the manager signals metadata changes itself.
  onChange();
}

/** Loads run records; anything still queued or running did not survive the restart. */
export function initRuns(changed: () => void, hooks: typeof lifecycle) {
  onChange = changed;
  lifecycle = hooks;
  mkdirSync(runsDir(), { recursive: true });
  for (const f of readdirSync(runsDir())) {
    if (!f.endsWith(".json")) continue;
    try {
      const meta = JSON.parse(readFileSync(join(runsDir(), f), "utf8")) as RunMeta;
      if (!meta?.id || !isRunId(meta.id)) continue;
      const stale = live(meta.status);
      if (stale) {
        meta.status = "interrupted";
        meta.endedAt ??= nowIso();
      }
      // Records written before usage was tracked get it from their transcript, once.
      const untracked = !meta.usage;
      if (untracked) {
        const lines = readTranscript(meta.id);
        const calls = new Set<string>();
        meta.turns = 0;
        for (const line of lines) track(meta, line, calls);
        account(meta, lines);
      }
      if (stale || untracked) writeAtomic(metaFile(meta.id), JSON.stringify(meta, null, 2) + "\n");
      metas.set(meta.id, meta);
    } catch {
      // An unreadable record is skipped.
    }
  }
}

export const getRun = (id: string) => metas.get(id);
/** Newest first. Ids start with a UTC timestamp, so they sort by time. */
export function listRuns(limit?: number): RunMeta[] {
  const all = [...metas.values()].sort((a, b) => (a.id < b.id ? 1 : -1));
  return limit ? all.slice(0, limit) : all;
}
export const hasLiveRuns = () => [...metas.values()].some((m) => live(m.status));
export const findLiveRun = (pred: (m: RunMeta) => boolean) => listRuns().find((m) => live(m.status) && pred(m));

const COUNTS = ["input", "output", "cacheRead", "cacheWrite", "costUsd"] as const;

/**
 * Counts a transcript line toward the figures shown while a run is live: a turn per model call of
 * the main session, and the largest prompt it sent. True when the line changed them.
 */
function track(meta: RunMeta, line: Line, calls: Set<string>): boolean {
  const id = line.message?.id;
  if (line.type !== "assistant" || line.parent_tool_use_id || !id || calls.has(id)) return false;
  calls.add(id);
  const u = line.message.usage ?? {};
  meta.turns++;
  meta.peakContext = Math.max(meta.peakContext ?? 0, (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0));
  return true;
}

/**
 * Sets a run's usage and cost from its transcript. Every result line carries totals
 * for the whole session, resumes included, so what one start or resume used is the last total
 * before the next message minus the total before it.
 */
function account(meta: RunMeta, lines: Line[]) {
  const usage: RunUsage[] = [];
  const totals = new Map<string, RunUsage>();
  let at = meta.createdAt;
  let result: Line | undefined;
  const close = () => {
    for (const [model, u] of Object.entries<Line>(result?.modelUsage ?? {})) {
      const total: RunUsage = {
        at, model, input: u.inputTokens || 0, output: u.outputTokens || 0,
        cacheRead: u.cacheReadInputTokens || 0, cacheWrite: u.cacheCreationInputTokens || 0, costUsd: u.costUSD || 0,
      };
      const before = totals.get(model);
      totals.set(model, total);
      const used = { ...total };
      for (const k of COUNTS) used[k] -= before?.[k] ?? 0;
      if (COUNTS.some((k) => used[k] > 0)) usage.push(used);
    }
    result = undefined;
  };
  for (const line of lines) {
    if (line.type === "dash_prompt" || line.type === "dash_user") {
      close();
      at = line.time ?? at;
    } else if (line.type === "result") result = line;
  }
  close();
  meta.usage = usage;
  meta.costUsd = usage.reduce((sum, u) => sum + u.costUsd, 0);
}

function emit(a: Active, line: Line) {
  a.lines.push(line);
  const text = JSON.stringify(line) + "\n";
  a.writes = a.writes.then(() => appendFile(logFile(a.meta.id), text)).catch(() => {});
  for (const sub of a.subs) sub(line);
}

export function startRun(init: RunInit, spec: RunSpec, prompt: string, onDone?: DoneHook): RunMeta {
  const d = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  let id = `${d}-${randomId(4)}`;
  while (metas.has(id)) id = `${d}-${randomId(4)}`;
  const meta: RunMeta = { id, ...init, status: "queued", createdAt: nowIso(), costUsd: 0, turns: 0, spec };
  metas.set(id, meta);
  const a: Active = { meta, lines: [], subs: new Set(), writes: Promise.resolve(), calls: new Set(), pending: [] };
  active.set(id, a);
  emit(a, { type: "dash_prompt", text: prompt, time: nowIso() });
  saveMeta(meta);
  if (onDone) hooks.set(id, onDone);
  lifecycle.started(meta);
  queue.push({ id, prompt, resume: false });
  pump();
  return meta;
}

function pump() {
  const max = Math.max(1, loadConfig().maxConcurrentRuns || 1);
  for (const job of [...queue]) {
    const a = active.get(job.id);
    // The Shuttle is the owner's live conversation, so it never waits behind background work.
    if (a?.meta.kind !== "shuttle" && [...active.values()].filter((x) => x.proc).length >= max) continue;
    queue.splice(queue.indexOf(job), 1);
    if (a) void execute(a, job);
  }
}

function buildArgs(meta: RunMeta, resume: boolean): string[] {
  const s = meta.spec;
  // Input is a stream of messages too, so a note can reach the session while it works.
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-mode", s.permissionMode];
  if (s.model) args.push("--model", s.model);
  if (s.systemPrompt) args.push("--append-system-prompt", s.systemPrompt);
  for (const d of s.addDirs ?? []) args.push("--add-dir", d);
  if (resume) args.push("--resume", meta.sessionId!);
  else {
    args.push("--name", `dash: ${meta.title.slice(0, 80)}`);
    if (s.worktree) args.push("--worktree", s.worktree);
  }
  if (s.disallowedTools?.length) args.push("--disallowedTools", s.disallowedTools.join(","));
  // Last, because it is variadic. The prompt goes over stdin, so it cannot be swallowed.
  if (s.allowedTools.length) args.push("--allowedTools", ...s.allowedTools);
  return args;
}

async function execute(a: Active, job: Job) {
  const { meta } = a;
  const bin = loadConfig().claudeBin || "claude";
  // A resumed session must start where it lived, for example inside its worktree.
  const cwd = job.resume && meta.sessionCwd && existsSync(meta.sessionCwd) ? meta.sessionCwd : meta.spec.cwd;
  const env: Record<string, string | undefined> = { ...process.env };
  // The child must not think it is nested inside another Claude Code session.
  for (const k of ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT"]) delete env[k];

  const { shell } = meta.spec;
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    // A command's stderr joins its stdout, so the transcript shows both in order.
    proc = Bun.spawn(shell ? ["sh", "-c", `exec 2>&1\n${job.prompt}`] : [bin, ...buildArgs(meta, job.resume)], {
      cwd, env, stdin: shell ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe",
    });
  } catch (e) {
    return finish(a, "failed", `could not run ${shell ? "sh" : bin}: ${(e as Error).message}`);
  }
  a.proc = proc;
  if (!shell) {
    a.input = proc.stdin as import("bun").FileSink;
    for (const text of [job.prompt, ...a.pending.splice(0)]) a.input.write(userMessage(text));
    a.input.flush();
  }
  meta.status = "running";
  meta.startedAt ??= nowIso();
  saveMeta(meta);

  let stderr = "";
  let resultError = false;
  let resultText: string | undefined;
  const readErr = (async () => {
    const dec = new TextDecoder();
    for await (const chunk of proc.stderr as unknown as AsyncIterable<Uint8Array>) {
      stderr = (stderr + dec.decode(chunk, { stream: true })).slice(-4000);
    }
  })().catch(() => {});

  const handle = (raw: string) => {
    if (shell) return emit(a, { type: "dash_output", text: raw });
    if (!raw.trim()) return;
    let line: Line;
    try {
      line = JSON.parse(raw);
    } catch {
      return;
    }
    if (!line || typeof line !== "object") return;
    if (line.type === "system") {
      if (typeof line.subtype === "string" && line.subtype.startsWith("hook_")) return;
      if (line.subtype === "init") {
        if (line.session_id) meta.sessionId = line.session_id;
        if (line.cwd) meta.sessionCwd = line.cwd;
        saveMeta(meta);
        return emit(a, { type: "system", subtype: "init", cwd: line.cwd, model: line.model, session_id: line.session_id });
      }
    } else if (line.type === "result") {
      if (typeof line.result === "string") meta.result = resultText = line.result;
      resultError = !!line.is_error;
      meta.resultAt = nowIso();
      // The session ends once its input closes. A note already written is still read first.
      a.input?.end();
      a.input = undefined;
    } else if (track(meta, line, a.calls)) saveMeta(meta);
    emit(a, line);
  };

  try {
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    if (buf) handle(buf);
  } catch {
    // The read loop ends when the process is killed.
  }
  const code = await proc.exited;
  await readErr;

  if (a.stopRequested) return finish(a, "stopped");
  if (code !== 0 || resultError) {
    const error = stderr.trim().slice(-1500) || (resultError ? resultText : "") || `${shell ? "the command" : "claude"} exited with code ${code}`;
    return finish(a, "failed", error);
  }
  return finish(a, "done");
}

async function finish(a: Active, status: RunStatus, error?: string) {
  const { meta } = a;
  meta.status = status;
  meta.endedAt = nowIso();
  if (error) meta.error = error;
  emit(a, { type: "dash_end", status, time: meta.endedAt, ...(error ? { error } : {}) });
  account(meta, a.lines);
  await a.writes;
  a.proc = undefined;
  a.input = undefined;
  active.delete(meta.id);
  try {
    const start = a.lines.findLastIndex((l) => l.type === "dash_prompt" || l.type === "dash_user");
    lifecycle.finished(meta, a.lines.slice(start));
  } catch (e) {
    console.error(`run ${meta.id}: finish tracking failed:`, e);
  }
  const hook = hooks.get(meta.id);
  hooks.delete(meta.id);
  if (hook) {
    try {
      await hook(meta);
    } catch (e) {
      console.error(`run ${meta.id}: completion hook failed:`, e);
    }
  }
  saveMeta(meta);
  for (const sub of a.subs) sub(null);
  pump();
}

export function stopRun(id: string): boolean {
  const a = active.get(id);
  if (!a) return false;
  a.stopRequested = true;
  const i = queue.findIndex((j) => j.id === id);
  if (i >= 0) {
    queue.splice(i, 1);
    void finish(a, "stopped");
  } else a.proc?.kill("SIGTERM");
  return true;
}

export function readTranscript(id: string): Line[] {
  try {
    return readFileSync(logFile(id), "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as Line];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

const userMessage = (text: string) => JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n";

/** How a note reads to a Thread: whose words it is decides what it may change. */
export const noteText = (by: string, text: string) => `Note from ${by === "me" ? "the owner" : "an agent"}: ${text}`;

/**
 * Writes a note into a session that is queued or working; it is read at the next step. False when
 * the run is not taking input, so the caller knows it did not arrive.
 */
export function sendNote(id: string, text: string): boolean {
  const a = active.get(id);
  if (!a || (a.proc && !a.input)) return false;
  emit(a, { type: "dash_note", text, time: nowIso() });
  if (!a.input) a.pending.push(text);
  else {
    a.input.write(userMessage(text));
    a.input.flush();
  }
  return true;
}

/**
 * Continues a finished run's session; usage is added to the same run, and the run's own completion
 * hook does not fire again. The message carries the time, since the session's opening prompt holds
 * the time it started, and a Thread first gets the notes recorded after its last result.
 */
export function sendMessage(id: string, message: string): RunMeta {
  const meta = metas.get(id);
  if (!meta) throw new Error("no such run");
  if (active.has(id) || live(meta.status)) throw new Error("the run is still in progress");
  if (!meta.sessionId) throw new Error("the run has no session to resume");
  const missed = meta.kind === "task" && meta.project && meta.taskId
    ? readTimeline(meta.project, meta.taskId).filter((e) => e.type === "note" && e.time > (meta.resultAt ?? meta.endedAt ?? "")).map((e) => noteText(e.by, e.body))
    : [];
  const a: Active = { meta, lines: readTranscript(id), subs: new Set(), writes: Promise.resolve(), calls: new Set(), pending: [] };
  active.set(id, a);
  meta.status = "queued";
  delete meta.endedAt;
  delete meta.error;
  const text = [`Loom: ${nowIso()}`, ...missed, message].filter(Boolean).join("\n");
  emit(a, { type: "dash_user", text, time: nowIso() });
  saveMeta(meta);
  lifecycle.started(meta);
  queue.push({ id, prompt: text, resume: true });
  pump();
  return meta;
}

/**
 * Every line so far, then live lines, then `null` when the run ends. For an active run the replay
 * and the subscription happen in one synchronous step, so no line is missed or duplicated.
 */
export function subscribe(id: string, cb: Subscriber): () => void {
  const a = active.get(id);
  if (!a) {
    for (const line of readTranscript(id)) cb(line);
    cb(null);
    return () => {};
  }
  for (const line of a.lines) cb(line);
  a.subs.add(cb);
  return () => a.subs.delete(cb);
}
