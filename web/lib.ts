import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Priority, ProjectSnapshot, RunMeta, Snapshot, TaskStatus, TaskSummary } from "../server/types";

// ---------- api ----------

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `${res.status} ${res.statusText}`);
  return data as T;
}

export const enc = encodeURIComponent;

// ---------- app context ----------

export interface AppCtx {
  snap: Snapshot;
  /** Bumped on every change signal, so detail views refetch. */
  rev: number;
  toast: (message: string) => void;
  /** Runs a mutation and shows its error, if any, in a toast. */
  act: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  openRun: (id: string) => void;
  openSettings: () => void;
}
export const Ctx = createContext<AppCtx>(null as any);
export const useApp = () => useContext(Ctx);

/** Fetches on mount and whenever `rev` changes; a response that arrives out of order is dropped. */
export function useData<T>(path: string | null): { data?: T; error?: string; reload: () => void } {
  const { rev } = useApp();
  const [state, setState] = useState<{ path?: string | null; data?: T; error?: string }>({});
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (!path) return;
    const mine = ++seq.current;
    api<T>("GET", path).then(
      (data) => mine === seq.current && setState({ path, data }),
      (e) => mine === seq.current && setState({ path, error: (e as Error).message }),
    );
  }, [path, rev, tick]);
  const current = state.path === path ? state : {};
  return { data: current.data, error: current.error, reload: () => setTick((t) => t + 1) };
}

// ---------- routing ----------

export interface Route {
  parts: string[];
  query: URLSearchParams;
}
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const q = raw.indexOf("?");
  const path = q >= 0 ? raw.slice(0, q) : raw;
  return {
    parts: path.split("/").filter(Boolean).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    }),
    query: new URLSearchParams(q >= 0 ? raw.slice(q + 1) : ""),
  };
}
export function useRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return parseHash(hash);
}
/** The current hash with one query parameter set or removed. */
export function hashWith(key: string, value: string | null): string {
  const raw = location.hash.replace(/^#/, "") || "/";
  const q = raw.indexOf("?");
  const params = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : "");
  if (value === null) params.delete(key);
  else params.set(key, value);
  const qs = params.toString().replace(/=(&|$)/g, "$1");
  return `#${q >= 0 ? raw.slice(0, q) : raw}${qs ? `?${qs}` : ""}`;
}
export const go = (hash: string) => {
  location.hash = hash;
};
export const taskHref = (slug: string, id: string) => `#/p/${enc(slug)}/t/${enc(id)}`;
export const docHref = (slug: string, name: string) => `#/p/${enc(slug)}/a/${enc(name)}`;

// ---------- formatting ----------

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "Todo", doing: "In progress", review: "To review", blocked: "Blocked", done: "Done",
};
export const GROUPS: { status: TaskStatus; label: string }[] = [
  { status: "review", label: "To review" },
  { status: "blocked", label: "Blocked" },
  { status: "doing", label: "In progress" },
  { status: "todo", label: "Up next" },
  { status: "done", label: "Done" },
];
const PRIO: Record<Priority, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };
const idNum = (id: string) => Number(id.slice(2)) || 0;
/** Priority, then due date (none last), then id. */
export function sortTasks<T extends TaskSummary>(tasks: T[]): T[] {
  return [...tasks].sort(
    (a, b) => PRIO[a.priority] - PRIO[b.priority] || (a.due ?? "9999").localeCompare(b.due ?? "9999") || idNum(a.id) - idNum(b.id),
  );
}

export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function dueLabel(due: string, done: boolean): { text: string; overdue: boolean } {
  const [y, m, d] = due.split("-").map(Number);
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1);
  const now = new Date();
  const days = Math.round((date.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  const short = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (done) return { text: short, overdue: false };
  if (days < 0) return { text: `${-days}d overdue`, overdue: true };
  if (days === 0) return { text: "today", overdue: false };
  if (days === 1) return { text: "tomorrow", overdue: false };
  return { text: short, overdue: false };
}
export function ago(iso?: string): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
export const stamp = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const money = (n: number) => `$${n.toFixed(2)}`;
export const isLive = (r: RunMeta) => r.status === "queued" || r.status === "running";

// ---------- hierarchy ----------

export interface Tree {
  byId: Map<string, TaskSummary>;
  children: Map<string, TaskSummary[]>;
  roots: TaskSummary[];
}
/** A task whose parent chain loops is treated as top-level, so every task stays reachable. */
export function buildTree(tasks: TaskSummary[]): Tree {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const cyclic = (t: TaskSummary) => {
    const seen = new Set<string>();
    for (let cur: TaskSummary | undefined = t; cur?.parent; cur = byId.get(cur.parent)) {
      if (seen.has(cur.id)) return true;
      seen.add(cur.id);
    }
    return false;
  };
  const children = new Map<string, TaskSummary[]>();
  const roots: TaskSummary[] = [];
  for (const t of [...tasks].sort((a, b) => idNum(a.id) - idNum(b.id))) {
    if (t.parent && byId.has(t.parent) && !cyclic(t)) children.set(t.parent, [...(children.get(t.parent) ?? []), t]);
    else roots.push(t);
  }
  return { byId, children, roots };
}
export function descendants(tree: Tree, id: string): TaskSummary[] {
  const out: TaskSummary[] = [];
  const walk = (i: string) => {
    for (const c of tree.children.get(i) ?? []) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

export const openCount = (p: ProjectSnapshot) => p.tasks.filter((t) => t.status !== "done").length;
/** The latest coding-agent run for a task, if any. */
export const agentRun = (runs: RunMeta[], slug: string, id: string) =>
  runs.find((r) => r.kind === "task" && r.project === slug && r.taskId === id);

/** Cmd/Ctrl+Enter submits. */
export const onSubmitKey = (fn: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    fn();
  }
};
