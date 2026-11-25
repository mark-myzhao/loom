import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isClosed, type Priority, type ProjectSnapshot, type RunMeta, type Snapshot, type TaskStatus, type TaskSummary } from "../server/types";

// ---------- api ----------

// The server gives this page, and no other caller, the token that marks its notes and Starts as the owner's.
let ownerToken: Promise<string> | undefined;

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  ownerToken ??= fetch("/api/owner").then((r) => r.json()).then((d) => String(d.token ?? ""), () => "");
  const res = await fetch(`/api${path}`, {
    method,
    headers: method === "GET" ? undefined : { "Content-Type": "application/json", "X-Loom-Owner": await ownerToken },
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
  /** `bad` marks a failure, so it does not read like a confirmation. */
  toast: (message: string, bad?: boolean) => void;
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

/**
 * Hash navigation never moves the scroll position by itself. A page opened by a link starts at the
 * top; Back and Forward return to where that page was left, which each history entry remembers.
 */
export function useScrollMemory(page: string) {
  const restoring = useRef(false);
  useEffect(() => {
    history.scrollRestoration = "manual";
    let timer = 0;
    const save = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!restoring.current) history.replaceState({ ...history.state, y: Math.round(scrollY) }, "");
      }, 120);
    };
    // A save still pending when the hash changes would land on the new entry.
    const cancel = () => clearTimeout(timer);
    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("hashchange", cancel);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", save);
      window.removeEventListener("hashchange", cancel);
    };
  }, []);
  useLayoutEffect(() => {
    const y: number = history.state?.y ?? 0;
    window.scrollTo(0, y);
    if (!y) return;
    // A detail page is still loading when the route changes: keep trying until it is tall enough.
    restoring.current = true;
    const until = performance.now() + 1500;
    let frame = requestAnimationFrame(function again() {
      if (Math.abs(scrollY - y) < 2 || performance.now() > until) return void (restoring.current = false);
      window.scrollTo(0, y);
      frame = requestAnimationFrame(again);
    });
    return () => {
      cancelAnimationFrame(frame);
      restoring.current = false;
    };
  }, [page]);
}
export const taskHref = (slug: string, id: string) => `#/p/${enc(slug)}/t/${enc(id)}`;
export const docHref = (slug: string, name: string) => `#/p/${enc(slug)}/a/${enc(name)}`;

// ---------- formatting ----------

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "Todo", "in-progress": "In progress", review: "To review", blocked: "Blocked", done: "Done", cancelled: "Cancelled",
};
export const GROUPS: { status: TaskStatus; label: string }[] = [
  { status: "review", label: "To review" },
  { status: "blocked", label: "Blocked" },
  { status: "in-progress", label: "In progress" },
  { status: "todo", label: "Up next" },
  { status: "done", label: "Done" },
  { status: "cancelled", label: "Cancelled" },
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
/** A `YYYY-MM-DD` day as a person would say it: today, yesterday, Nov 3, Nov 3, 2025. */
export function day(date?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!m) return date || "never";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - d.getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
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

export const openCount = (p: ProjectSnapshot) => p.tasks.filter((t) => !isClosed(t.status)).length;
/** The latest Thread's run for a task, if any. */
export const agentRun = (runs: RunMeta[], slug: string, id: string) =>
  runs.find((r) => r.kind === "task" && r.project === slug && r.taskId === id);

/** Cmd/Ctrl+Enter submits. */
export const onSubmitKey = (fn: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    fn();
  }
};
