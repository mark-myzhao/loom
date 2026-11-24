import { useEffect, useMemo, useState } from "react";
import type { GraphEdge, GraphNode, ProjectSnapshot, TaskStatus, TaskSummary } from "../../server/types";
import { TASK_STATUSES } from "../../server/types";
import { agentRun, api, buildTree, descendants, docHref, dueLabel, enc, go, isLive, STATUS_LABEL, taskHref, useApp, type Tree } from "../lib";
import { Empty, Ring } from "../ui";

const W = 184, H = 46, COL = 36, ROW = 10, TREE = 16;

interface Placed {
  task: TaskSummary;
  x: number;
  y: number;
  hidden: number;
  hasKids: boolean;
}
interface Layout {
  nodes: Placed[];
  edges: { from: Placed; to: Placed }[];
  width: number;
  height: number;
}

/** Parents on the left, children on the right; a parent sits at the middle of its children. */
function layout(roots: TaskSummary[], tree: Tree, visible: (t: TaskSummary) => boolean, collapsed: Set<string>): Layout {
  const nodes: Placed[] = [];
  const edges: Layout["edges"] = [];
  let row = 0, top = 0, maxDepth = 0;
  const place = (task: TaskSummary, depth: number): Placed => {
    const all = tree.children.get(task.id) ?? [];
    const kids = collapsed.has(task.id) ? [] : all.filter(visible);
    maxDepth = Math.max(maxDepth, depth);
    const node: Placed = {
      task, x: depth * (W + COL), y: 0, hasKids: all.some(visible),
      hidden: collapsed.has(task.id) ? descendants(tree, task.id).filter(visible).length : 0,
    };
    if (!kids.length) node.y = top + row++ * (H + ROW);
    else {
      const placed = kids.map((k) => place(k, depth + 1));
      node.y = (placed[0]!.y + placed[placed.length - 1]!.y) / 2;
      for (const k of placed) edges.push({ from: node, to: k });
    }
    nodes.push(node);
    return node;
  };
  for (const r of roots) {
    place(r, 0);
    top += row * (H + ROW) + TREE - ROW;
    row = 0;
  }
  return { nodes, edges, width: (maxDepth + 1) * (W + COL) - COL, height: Math.max(0, top - TREE) };
}

export function Graph({ project: p }: { project: ProjectSnapshot }) {
  const { snap } = useApp();
  const [hideDone, setHideDone] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<{ id: string; x: number; y: number } | null>(null);
  const [links, setLinks] = useState(true);
  const tree = useMemo(() => buildTree(p.tasks), [p.tasks]);

  // "Hide done" keeps a completed ancestor that still has open work beneath it.
  const visible = useMemo(() => {
    const keep = new Set(p.tasks.filter((t) => !hideDone || t.status !== "done" || descendants(tree, t.id).some((d) => d.status !== "done")).map((t) => t.id));
    return (t: TaskSummary) => keep.has(t.id);
  }, [p.tasks, hideDone, tree]);

  const roots = tree.roots.filter(visible);
  const withKids = roots.filter((r) => (tree.children.get(r.id) ?? []).some(visible));
  const alone = roots.filter((r) => !withKids.includes(r));
  const lay = useMemo(() => layout(withKids, tree, visible, collapsed), [withKids.map((r) => r.id).join(), tree, visible, collapsed]);

  const related = useMemo(() => {
    if (!focus) return null;
    const set = new Set([focus.id, ...descendants(tree, focus.id).map((d) => d.id)]);
    for (let cur = tree.byId.get(focus.id); cur?.parent && !set.has(cur.parent); cur = tree.byId.get(cur.parent)) set.add(cur.parent);
    return set;
  }, [focus?.id, tree]);
  const dim = (id: string) => (related && !related.has(id) ? " dim" : "");
  const views = (
    <span className="btn-row">
      <button className={links ? "primary" : ""} onClick={() => setLinks(true)}>Links</button>
      <button className={links ? "" : "primary"} onClick={() => setLinks(false)}>Task tree</button>
    </span>
  );
  if (links) return <LinkGraph slug={p.slug} bar={<div className="graph-bar">{views}</div>} />;

  const toggle = (id: string) => {
    const next = new Set(collapsed);
    next.has(id) ? next.delete(id) : next.add(id);
    setCollapsed(next);
  };

  const node = (n: { task: TaskSummary; hidden?: number; hasKids?: boolean }, style?: React.CSSProperties) => {
    const t = n.task;
    const run = agentRun(snap.runs, p.slug, t.id);
    const show = (e: { currentTarget: HTMLElement }) => {
      const r = e.currentTarget.getBoundingClientRect();
      setFocus({ id: t.id, x: Math.min(r.left, window.innerWidth - 336), y: r.bottom + 8 });
    };
    return (
      <div key={t.id} className={`gnode st-${t.status}${run && isLive(run) ? " agent" : ""}${dim(t.id)}`} style={style}>
        <button className="gnode-main" onClick={() => go(taskHref(p.slug, t.id))} onMouseEnter={show} onMouseLeave={() => setFocus(null)} onFocus={show} onBlur={() => setFocus(null)}>
          <span className="id">{t.id}</span>
          <span className="gnode-title">{t.title}</span>
        </button>
        {n.hasKids && (
          <button className="gnode-toggle" onClick={() => toggle(t.id)} title={n.hidden ? "Expand" : "Collapse"} aria-label={n.hidden ? `Expand ${t.id}` : `Collapse ${t.id}`}>
            {n.hidden ? `+${n.hidden}` : "–"}
          </button>
        )}
      </div>
    );
  };

  const focused = focus && tree.byId.get(focus.id);
  if (!p.tasks.length) return <Empty>No tasks to draw yet. Subtasks you add on a task page appear here as a tree.</Empty>;
  return (
    <div className="graph">
      <div className="graph-bar">
        {views}
        <span className="legend">
          {TASK_STATUSES.map((s: TaskStatus) => (
            <span key={s}><Ring status={s} size={12} /> {STATUS_LABEL[s]} {p.tasks.filter((t) => t.status === s).length}</span>
          ))}
        </span>
        <span className="btn-row">
          {collapsed.size > 0 && <button onClick={() => setCollapsed(new Set())}>Expand all</button>}
          <label className="check"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide done</label>
        </span>
      </div>

      {withKids.length > 0 && (
        <div className="graph-scroll">
          <div className="graph-canvas" style={{ width: lay.width, height: lay.height }}>
            <svg width={lay.width} height={lay.height} aria-hidden="true">
              {lay.edges.map(({ from, to }) => {
                const x1 = from.x + W, y1 = from.y + H / 2, x2 = to.x, y2 = to.y + H / 2, mx = (x1 + x2) / 2;
                const lit = !related || (related.has(from.task.id) && related.has(to.task.id));
                return <path key={to.task.id} className={lit ? "" : "dim"} d={`M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} />;
              })}
            </svg>
            {lay.nodes.map((n) => node(n, { position: "absolute", left: n.x, top: n.y }))}
          </div>
        </div>
      )}

      {alone.length > 0 && (
        <section className="group">
          <h3 className="label">Without subtasks <span className="count">{alone.length}</span></h3>
          <div className="graph-loose">{alone.map((t) => node({ task: t }))}</div>
        </section>
      )}
      {!roots.length && <Empty>Everything here is done. Untick “Hide done” to see it.</Empty>}

      {focus && focused && (
        <div className="hovercard" style={{ left: Math.max(8, focus.x), top: Math.min(focus.y, window.innerHeight - 200) }}>
          <p className="label"><Ring status={focused.status} size={12} /> {STATUS_LABEL[focused.status]} · {focused.id}</p>
          <h4>{focused.title}</h4>
          <p className="facts">
            {focused.priority.toUpperCase()}
            {focused.due && ` · due ${dueLabel(focused.due, focused.status === "done").text}`}
            {focused.total > 0 && ` · ${focused.checked}/${focused.total} checked`}
            {focused.repo && ` · ${focused.repo}`}
          </p>
          {focused.excerpt && <p className="clamp">{focused.excerpt}</p>}
        </div>
      )}
    </div>
  );
}

const KINDS: GraphNode["kind"][] = ["task", "thread", "document", "link", "repository", "file", "memory"];

/**
 * A spring layout (Fruchterman-Reingold): every pair pushes apart, each edge pulls its ends together,
 * and the step shrinks as it cools. Starts on a spiral so the same graph always lands the same way.
 */
function settle(n: number, edges: [number, number][]) {
  const K = 70;
  const pos = Array.from({ length: n }, (_, i) => ({ x: Math.cos(i * 2.4) * 12 * Math.sqrt(i + 1), y: Math.sin(i * 2.4) * 12 * Math.sqrt(i + 1) }));
  for (let step = 0, STEPS = 300; step < STEPS; step++) {
    const f = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i]!.x - pos[j]!.x, dy = pos[i]!.y - pos[j]!.y, k = (K * K) / (dx * dx + dy * dy || 0.01);
        f[i]!.x += dx * k; f[i]!.y += dy * k; f[j]!.x -= dx * k; f[j]!.y -= dy * k;
      }
    for (const [a, b] of edges) {
      const dx = pos[b]!.x - pos[a]!.x, dy = pos[b]!.y - pos[a]!.y, k = Math.hypot(dx, dy) / K;
      f[a]!.x += dx * k; f[a]!.y += dy * k; f[b]!.x -= dx * k; f[b]!.y -= dy * k;
    }
    const max = 40 * (1 - step / STEPS) + 1;
    pos.forEach((p, i) => {
      const fx = f[i]!.x - p.x * 0.05, fy = f[i]!.y - p.y * 0.05, d = Math.hypot(fx, fy) || 1; // a little gravity keeps islands near
      p.x += (fx / d) * Math.min(d, max);
      p.y += (fy / d) * Math.min(d, max);
    });
  }
  return pos;
}

/** The project's graph as GRAPH.md has it: every node and edge, drawn live from the files. */
function LinkGraph({ slug, bar }: { slug: string; bar: React.ReactNode }) {
  const { rev, act } = useApp();
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  useEffect(() => {
    act(() => api<{ nodes: GraphNode[]; edges: GraphEdge[] }>("GET", `/projects/${enc(slug)}/graph`)).then((g) => g && setGraph(g));
  }, [slug, rev]);

  const drawn = useMemo(() => {
    if (!graph) return null;
    const index = new Map(graph.nodes.map((n, i) => [n.address, i]));
    // A section link lands on its file; missing links are listed in GRAPH.md, not drawn. One line per pair.
    const lines = new Map<string, { a: number; b: number; rels: Set<string> }>();
    for (const e of graph.edges) {
      const a = index.get(e.from), b = index.get(e.to.split("#")[0]!);
      if (a === undefined || b === undefined || a === b) continue;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const line = lines.get(key) ?? lines.set(key, { a, b, rels: new Set() }).get(key)!;
      line.rels.add(`${e.from} ${e.rel} ${e.to}`);
    }
    const pos = settle(graph.nodes.length, [...lines.values()].map((l) => [l.a, l.b]));
    const xs = pos.map((p) => p.x), ys = pos.map((p) => p.y);
    const box = { x: Math.min(...xs) - 40, y: Math.min(...ys) - 30, w: Math.max(...xs) - Math.min(...xs) + 160, h: Math.max(...ys) - Math.min(...ys) + 60 };
    return { pos, lines: [...lines.values()], box };
  }, [graph]);

  if (!graph || !drawn) return <>{bar}</>;
  const near = focus === null ? null : new Set([focus, ...drawn.lines.flatMap((l) => (l.a === focus ? [l.b] : l.b === focus ? [l.a] : []))]);
  const open = (n: GraphNode) => {
    if (n.kind === "task" || n.kind === "thread") go(taskHref(slug, n.address.replace(/\.\d+$/, "")));
    else if (n.kind === "memory") go(`#/p/${enc(slug)}/memory`);
    else if (n.kind !== "file") go(docHref(slug, n.address));
  };
  const card = focus === null ? null : graph.nodes[focus]!;
  return (
    <div className="graph">
      {bar}
      <p className="legend link-legend">
        {KINDS.filter((k) => graph.nodes.some((n) => n.kind === k)).map((k) => (
          <span key={k}><svg width="12" height="12"><circle className={`gk-${k}`} cx="6" cy="6" r="5" /></svg> {k}</span>
        ))}
      </p>
      <p className="graph-card">{card ? card.card : "Hover a node for its card and neighbours; click it to open it."}</p>
      <svg className="link-graph" viewBox={`${drawn.box.x} ${drawn.box.y} ${drawn.box.w} ${drawn.box.h}`}>
        {drawn.lines.map((l) => (
          <line key={`${l.a}-${l.b}`} className={near && !(near.has(l.a) && near.has(l.b)) ? "dim" : ""}
            x1={drawn.pos[l.a]!.x} y1={drawn.pos[l.a]!.y} x2={drawn.pos[l.b]!.x} y2={drawn.pos[l.b]!.y}>
            <title>{[...l.rels].join("\n")}</title>
          </line>
        ))}
        {graph.nodes.map((n, i) => (
          <g key={n.address} className={`gn${near && !near.has(i) ? " dim" : ""}`} transform={`translate(${drawn.pos[i]!.x} ${drawn.pos[i]!.y})`}
            onMouseEnter={() => setFocus(i)} onMouseLeave={() => setFocus(null)} onClick={() => open(n)}>
            <circle className={`gk-${n.kind}`} r={n.kind === "task" ? 7 : 5} />
            <text x="10" y="4">{n.address}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
