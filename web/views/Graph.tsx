import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode, ProjectSnapshot, TaskStatus, TaskSummary } from "../../server/types";
import { TASK_STATUSES } from "../../server/types";
import { agentRun, api, buildTree, descendants, docHref, dueLabel, enc, go, isLive, STATUS_LABEL, taskHref, useApp, type Tree } from "../lib";
import { Select } from "../controls";
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
  if (links) return <LinkGraph slug={p.slug} views={views} />;

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
 * Then labels are pushed apart until no two overlap; `widths` is each label's width.
 */
function settle(widths: number[], edges: [number, number][]) {
  const n = widths.length, K = 90;
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
  // A node and its label are a box from the dot to the label's end; move each overlapping pair apart
  // along the axis that needs the smaller move.
  for (let pass = 0, moved = true; pass < 200 && moved; pass++) {
    moved = false;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = pos[i]!, b = pos[j]!;
        const ox = Math.min(a.x + widths[i]!, b.x + widths[j]!) - Math.max(a.x, b.x) + 20, oy = 22 - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox < oy) {
          const d = (a.x < b.x ? -ox : ox) / 2;
          a.x += d; b.x -= d;
        } else {
          const d = (a.y < b.y ? -oy : oy) / 2;
          a.y += d; b.y -= d;
        }
      }
  }
  return pos;
}

type Edges = { nodes: GraphNode[]; edges: GraphEdge[] };
type Point = { x: number; y: number };

/** A task's subtree and every node one edge away from it: its documents, Threads, links and the tasks it mentions. */
function around(graph: Edges, task: string): GraphNode[] {
  const base = (to: string) => to.split("#")[0]!;
  const core = new Set([task]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of graph.edges) if (e.rel === "part of" && core.has(e.to) && !core.has(e.from)) core.add(e.from), (grew = true);
  }
  const near = new Set(core);
  for (const e of graph.edges) {
    if (core.has(e.from)) near.add(base(e.to));
    if (core.has(base(e.to))) near.add(e.from);
  }
  return graph.nodes.filter((n) => near.has(n.address));
}

/** The project's graph as GRAPH.md has it, live from the files: pan, zoom, drag a node, or narrow it to one task. */
function LinkGraph({ slug, views }: { slug: string; views: React.ReactNode }) {
  const { rev, act } = useApp();
  const [graph, setGraph] = useState<Edges | null>(null);
  const [task, setTask] = useState("");
  const [focus, setFocus] = useState<number | null>(null);
  const [pos, setPos] = useState<Point[]>([]);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ node: number | null; x: number; y: number; moved: boolean } | null>(null);
  useEffect(() => {
    act(() => api<Edges>("GET", `/projects/${enc(slug)}/graph`)).then((g) => g && setGraph(g));
  }, [slug, rev]);

  const drawn = useMemo(() => {
    if (!graph) return null;
    const nodes = task ? around(graph, task) : graph.nodes;
    const index = new Map(nodes.map((n, i) => [n.address, i]));
    // A section link lands on its file; missing links are listed in GRAPH.md, not drawn. One line per pair.
    const lines = new Map<string, { a: number; b: number; rels: Set<string> }>();
    for (const e of graph.edges) {
      const a = index.get(e.from), b = index.get(e.to.split("#")[0]!);
      if (a === undefined || b === undefined || a === b) continue;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      const line = lines.get(key) ?? lines.set(key, { a, b, rels: new Set() }).get(key)!;
      line.rels.add(`${e.from} ${e.rel} ${e.to}`);
    }
    const widths = nodes.map((n) => 14 + n.address.length * 6.2);
    return { nodes, lines: [...lines.values()], widths, layout: settle(widths, [...lines.values()].map((l) => [l.a, l.b])) };
  }, [graph, task]);

  /** Scale and centre the drawing, labels included, to fill the canvas. */
  const fit = (points: Point[]) => {
    const el = svg.current;
    if (!el || !drawn || points.length !== drawn.widths.length) return;
    const ys = points.map((p) => p.y);
    const [x0, x1] = [Math.min(...points.map((p) => p.x)) - 10, Math.max(...points.map((p, i) => p.x + drawn.widths[i]!))];
    const [y0, y1] = [Math.min(...ys) - 10, Math.max(...ys) + 10];
    const k = Math.min((el.clientWidth - 40) / (x1 - x0), (el.clientHeight - 40) / (y1 - y0), 2);
    setView({ k, x: el.clientWidth / 2 - (k * (x0 + x1)) / 2, y: el.clientHeight / 2 - (k * (y0 + y1)) / 2 });
  };
  // A file change redraws in place; only a new filter re-fits, so the owner's zoom and pan survive edits.
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!drawn) return;
    setPos(drawn.layout);
    if (fitted.current !== task) fit(drawn.layout), (fitted.current = task), setFocus(null);
  }, [drawn]);

  // React's wheel listener is passive, so zooming needs a native one to stop the page scrolling.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(4, Math.max(0.2, v.k * Math.exp(-e.deltaY * 0.002)));
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [!!drawn]);

  if (!graph || !drawn) return <div className="graph-bar">{views}</div>;
  const open = (n: GraphNode) => {
    if (n.kind === "task" || n.kind === "thread") go(taskHref(slug, n.address.replace(/\.\d+$/, "")));
    else if (n.kind === "memory") go(`#/p/${enc(slug)}/memory`);
    else if (n.kind !== "file") go(docHref(slug, n.address));
  };
  // Dragging the background pans; dragging a node moves it; a press that does not move opens the node.
  const start = (e: React.PointerEvent, node: number | null) => {
    e.stopPropagation();
    svg.current!.setPointerCapture(e.pointerId);
    drag.current = { node, x: e.clientX, y: e.clientY, moved: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    Object.assign(d, { moved: true, x: e.clientX, y: e.clientY });
    if (d.node === null) setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    else setPos((ps) => ps.map((p, i) => (i === d.node ? { x: p.x + dx / view.k, y: p.y + dy / view.k } : p)));
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && d.node !== null) open(drawn.nodes[d.node]!);
  };

  const ready = pos.length === drawn.nodes.length;
  const near = focus === null ? null : new Set([focus, ...drawn.lines.flatMap((l) => (l.a === focus ? [l.b] : l.b === focus ? [l.a] : []))]);
  const card = focus === null ? null : drawn.nodes[focus];
  const tasks = graph.nodes.filter((n) => n.kind === "task");
  return (
    <div className="graph">
      <div className="graph-bar">
        {views}
        <span className="btn-row">
          <Select value={task} aria-label="Show the graph around a task" onChange={setTask}
            options={[{ value: "", label: "Whole project" }, ...tasks.map((t) => ({ value: t.address, label: `${t.address} ${/"(.*?)"/.exec(t.card)?.[1] ?? ""}` }))]} />
          <button onClick={() => fit(pos)}>Fit</button>
        </span>
      </div>
      <p className="legend link-legend">
        {KINDS.filter((k) => drawn.nodes.some((n) => n.kind === k)).map((k) => (
          <span key={k}><svg width="12" height="12"><circle className={`gk-${k}`} cx="6" cy="6" r="5" /></svg> {k}</span>
        ))}
      </p>
      <p className="graph-card">{card ? card.card : "Drag to pan, scroll to zoom, drag a node to move it, click a node to open it."}</p>
      <svg ref={svg} className="link-graph" onPointerDown={(e) => start(e, null)} onPointerMove={move} onPointerUp={end} onPointerCancel={() => (drag.current = null)}>
        {ready && (
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {drawn.lines.map((l) => (
              <line key={`${l.a}-${l.b}`} className={near && !(near.has(l.a) && near.has(l.b)) ? "dim" : ""}
                x1={pos[l.a]!.x} y1={pos[l.a]!.y} x2={pos[l.b]!.x} y2={pos[l.b]!.y}>
                <title>{[...l.rels].join("\n")}</title>
              </line>
            ))}
            {drawn.nodes.map((n, i) => (
              <g key={n.address} className={`gn${near && !near.has(i) ? " dim" : ""}${n.address === task ? " picked" : ""}`} transform={`translate(${pos[i]!.x} ${pos[i]!.y})`}
                onPointerDown={(e) => start(e, i)} onMouseEnter={() => !drag.current && setFocus(i)} onMouseLeave={() => !drag.current && setFocus(null)}>
                <circle className={`gk-${n.kind}`} r={n.kind === "task" ? 7 : 5} />
                <text x="10" y="4">{n.address}</text>
              </g>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}
