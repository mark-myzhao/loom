// Token usage rolled up for the Usage page and the `bun run usage` report. No Node imports: the
// browser bundles this file too.

import type { RunKind, RunMeta, RunUsage } from "./types";

/** One start or resume of a run on one model, with the run it belongs to. GET /api/usage */
export interface UsageRow extends RunUsage {
  run: string;
  kind: RunKind;
  title: string;
  turns: number;
  project?: string;
  taskId?: string;
  peakContext?: number;
}

export interface UsageSum {
  key: string;
  /** Distinct runs. */
  runs: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

export const usageRows = (runs: RunMeta[]): UsageRow[] =>
  runs.flatMap((r) =>
    (r.usage ?? []).map((u) => ({
      ...u, run: r.id, kind: r.kind, title: r.title, turns: r.turns, project: r.project, taskId: r.taskId, peakContext: r.peakContext,
    })),
  );

/** Totals per key, in first-seen order. */
export function sumUsage(rows: UsageRow[], keyOf: (r: UsageRow) => string): UsageSum[] {
  const sums = new Map<string, UsageSum>();
  const counted = new Set<string>();
  for (const r of rows) {
    const key = keyOf(r);
    const s = sums.get(key) ?? { key, runs: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
    sums.set(key, s);
    if (!counted.has(`${key}\n${r.run}`)) s.runs++;
    counted.add(`${key}\n${r.run}`);
    s.input += r.input;
    s.output += r.output;
    s.cacheRead += r.cacheRead;
    s.cacheWrite += r.cacheWrite;
    s.costUsd += r.costUsd;
  }
  return [...sums.values()];
}

/** Everything sent to the model: fresh input, cache writes and cache reads. */
export const promptTokens = (s: UsageSum) => s.input + s.cacheRead + s.cacheWrite;
/** The share of the prompt served from cache, 0 to 1. Low means sessions keep starting cold. */
export const cachedShare = (s: UsageSum) => (promptTokens(s) ? s.cacheRead / promptTokens(s) : 0);

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** The local day a timestamp falls on. */
export const dayOf = (iso: string) => ymd(new Date(iso));
/** The Monday of the local week a timestamp falls in. */
export function weekOf(iso: string): string {
  const d = new Date(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
}
/** 1234567 as "1.2M". */
export const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : String(n));

// ---------- telemetry: what the owner and the agents did (docs/design/usage/telemetry.md) ----------

export interface TelemetryEvent {
  t: string;
  src: "web" | "server";
  ev: "view" | "click" | "api" | "run.start" | "run.end";
  [field: string]: any;
}

/** The kind of page a dashboard route is, ids dropped, so every task page counts as one. */
export function pageOf(route: string): string {
  const [a = "", , b, c] = String(route).replace(/^#\/?/, "").split("?")[0]!.split("/");
  if (a !== "p") return a || "today";
  return b === "t" && c ? "task" : b === "a" && c ? "artifact" : `project ${b || "tasks"}`;
}

/** What an API write did, with the ids in its path, every other segment, written as stars. */
export function actionOf(e: TelemetryEvent): string {
  const path = String(e.path).replace(/^\/api\//, "").split("/").map((s, i) => (i % 2 ? "*" : s)).join("/");
  return `${e.method} ${path.replace(/^projects\/\*\//, "")}`;
}

/** Which of the five series an event belongs to, for the activity chart. */
export const classOf = (e: TelemetryEvent) =>
  e.ev === "api" ? (e.actor === "owner" ? "owner writes" : "agent writes") : e.ev === "run.start" ? "runs" : e.ev === "view" ? "views" : e.ev === "click" ? "clicks" : "";
export const CLASSES_OF_ACTIVITY = ["views", "clicks", "owner writes", "agent writes", "runs"];

export interface Count { key: string; n: number; owner: number }
/** Events per key, most first; `owner` counts those the owner made. */
export function countBy(events: TelemetryEvent[], keyOf: (e: TelemetryEvent) => string): Count[] {
  const counts = new Map<string, Count>();
  for (const e of events) {
    const c = counts.get(keyOf(e)) ?? { key: keyOf(e), n: 0, owner: 0 };
    counts.set(c.key, c);
    c.n++;
    if (e.actor === "owner") c.owner++;
  }
  return [...counts.values()].sort((a, b) => b.n - a.n);
}

export const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : 0);

/** Each run.end with how long it ran since its last run.start. */
export function runSpans(events: TelemetryEvent[]): (TelemetryEvent & { ms: number })[] {
  const started = new Map<string, string>();
  return events.flatMap((e) => {
    if (e.ev === "run.start") started.set(e.run, e.t);
    if (e.ev !== "run.end" || !started.has(e.run)) return [];
    return [{ ...e, ms: Date.parse(e.t) - Date.parse(started.get(e.run)!) }];
  });
}

/** For each Thread that finished, how long until the owner next wrote to its task. Still waiting is left out. */
export function reviewWaits(events: TelemetryEvent[]): number[] {
  return events.flatMap((e, i) => {
    if (e.ev !== "run.end" || e.kind !== "task" || !e.taskId) return [];
    const task = `/api/projects/${e.project}/tasks/${e.taskId}`;
    const next = events.slice(i + 1).find((x) => x.ev === "api" && x.actor === "owner" && `${x.path}/`.startsWith(`${task}/`));
    return next ? [Date.parse(next.t) - Date.parse(e.t)] : [];
  });
}

/** 95000 as "1.6 min". */
export const duration = (ms: number) =>
  ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 3_600_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 3_600_000).toFixed(1)} h`;
