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
