import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Project, Snapshot } from "../server/types";
import { api, Ctx, day, enc, go, hashWith, isLive, openCount, startTelemetry, useApp, useRoute, useScrollMemory, type AppCtx } from "./lib";
import { SHUTTLE_PATH, Wordmark } from "./ui";
import { Automations } from "./views/Automations";
import { DocPage } from "./views/Doc";
import { ProjectPage } from "./views/Project";
import { RunDrawer, Settings } from "./views/RunDrawer";
import { TaskPage } from "./views/TaskPage";
import { Activity, Shuttle, Today } from "./views/Today";
import { Usage } from "./views/Usage";

/** The rail's pages, each with an icon drawn like the marks: one 3.2-unit stroke on a 32-unit grid. */
const PAGES = [
  { route: "", label: "Today", icon: "M5 9h22v18H5zM5 15h22M11 4v6M21 4v6" },
  { route: "shuttle", label: "Shuttle", icon: SHUTTLE_PATH },
  { route: "activity", label: "Activity", icon: "M3 17h6l4-10 6 18 4-8h6" },
  { route: "automations", label: "Automations", icon: "M6.5 14A10 10 0 0 1 24 8.5M24 3.5v5h-5M25.5 18A10 10 0 0 1 8 23.5M8 28.5v-5h5" },
  { route: "usage", label: "Usage", icon: "M6 27V18M13 27V10M20 27V14M27 27V5" },
];
/** The rail's width in pixels: dragged between min and max, back to start on a double-click. */
const RAIL = { min: 180, max: 420, start: 236 };

function Rail({ snap, current, onSettings }: { snap: Snapshot; current: string[]; onSettings: () => void }) {
  const { act } = useApp();
  const [name, setName] = useState<string | null>(null);
  // Hidden and width are kept per browser, so the rail stays as the owner left it.
  const [width, setWidth] = useState(() => Number(localStorage.getItem("loom.railWidth")) || RAIL.start);
  const [hidden, setHidden] = useState(() => localStorage.getItem("loom.railHidden") === "1");
  useEffect(() => {
    localStorage.setItem("loom.railWidth", String(width));
    localStorage.setItem("loom.railHidden", hidden ? "1" : "");
  }, [width, hidden]);
  const resize = (w: number) => setWidth(Math.round(Math.min(RAIL.max, Math.max(RAIL.min, w))));
  // The rail starts at the window's left edge, so the pointer's x is the new width.
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    grip.onpointermove = (m) => resize(m.clientX);
    grip.onpointerup = () => (grip.onpointermove = null);
  };
  const open = snap.projects.filter((p) => p.status !== "done");
  const live = snap.runs.filter(isLive).length;
  const finished = snap.projects.filter((p) => p.status === "done");
  const create = async () => {
    if (!name?.trim()) return setName(null);
    const p = await act(() => api<Project>("POST", "/projects", { name }));
    if (p) {
      setName(null);
      go(`#/p/${enc(p.slug)}`);
    }
  };
  const on = (is: boolean) => (is ? { className: "on", "aria-current": "page" as const } : {});
  const item = (p: Snapshot["projects"][number]) => {
    const live = snap.runs.some((r) => r.project === p.slug && isLive(r));
    return (
      <a key={p.slug} href={`#/p/${enc(p.slug)}`} {...on(current[0] === "p" && current[1] === p.slug)}>
        <span className={`dot st-${p.status}${live ? " live" : ""}`} />
        <span className="rail-name">{p.name}</span>
        {openCount(p) > 0 && <span className="count">{openCount(p)}</span>}
      </a>
    );
  };
  const toggle = (
    <button className="rail-toggle" onClick={() => setHidden(!hidden)} title={hidden ? "Show sidebar" : "Hide sidebar"} aria-label={hidden ? "Show sidebar" : "Hide sidebar"} aria-expanded={!hidden}>
      <svg className="rail-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 6h22v20H5zM13 6v20" /></svg>
    </button>
  );
  if (hidden) return <nav className="rail hidden">{toggle}</nav>;
  return (
    <nav className="rail" style={{ "--rail-w": `${width}px` } as React.CSSProperties}>
      {toggle}
      <div className="rail-grip" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" aria-valuenow={width} aria-valuemin={RAIL.min} aria-valuemax={RAIL.max} tabIndex={0}
        onPointerDown={drag} onDoubleClick={() => setWidth(RAIL.start)}
        onKeyDown={(e) => (e.key === "ArrowLeft" ? resize(width - 16) : e.key === "ArrowRight" && resize(width + 16))} />
      <a className="brand" href="#/" aria-label="Loom, Today"><Wordmark /></a>
      {PAGES.map(({ route, label, icon }) => (
        <a key={label} href={`#/${route}`} {...on(route ? current[0] === route : current.length === 0)}>
          <svg className="rail-icon" viewBox="0 0 32 32" aria-hidden="true"><path d={icon} /></svg>
          {label}
          {route === "activity" && live > 0 && <span className="pill" title="Runs in progress"><span className="dot live" />{live}</span>}
        </a>
      ))}
      <p className="label">Projects</p>
      {open.map(item)}
      {name === null ? (
        <button className="link rail-new" onClick={() => setName("")}>+ New project</button>
      ) : (
        <input autoFocus className="rail-input" value={name} placeholder="Project name" onChange={(e) => setName(e.target.value)} onBlur={() => !name && setName(null)} onKeyDown={(e) => (e.key === "Enter" ? create() : e.key === "Escape" && setName(null))} />
      )}
      {finished.length > 0 && <p className="label">Finished</p>}
      {finished.map(item)}
      <footer>
        {snap.lastBackupPush && <p title={snap.lastBackupPush}>backed up {day(snap.lastBackupPush)}</p>}
        <button className="link" onClick={onSettings}>Settings</button>
      </footer>
    </nav>
  );
}

function App() {
  const route = useRoute();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [rev, setRev] = useState(0);
  const [connected, setConnected] = useState(true);
  const [toasts, setToasts] = useState<{ id: number; text: string; bad?: boolean }[]>([]);
  const [settings, setSettings] = useState(false);
  const seq = useRef(0);

  const toast = useCallback((text: string, bad?: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, bad }]);
    // A failure stays up longer: it usually has more to read.
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), bad ? 10000 : 5000);
  }, []);
  const refresh = useCallback(() => {
    const mine = ++seq.current;
    api<Snapshot>("GET", "/state").then(
      (s) => mine === seq.current && setSnap(s),
      (e) => toast((e as Error).message, true),
    );
    setRev((r) => r + 1);
  }, [toast]);

  // The watcher's change signal: refetch the snapshot and bump the detail-view revision.
  useEffect(() => {
    refresh();
    const es = new EventSource("/api/events");
    es.onopen = () => setConnected(true);
    es.onmessage = () => refresh();
    es.onerror = () => setConnected(false); // EventSource reconnects by itself.
    return () => es.close();
  }, [refresh]);

  const ctx = useMemo<AppCtx | null>(
    () =>
      snap && {
        snap, rev, toast,
        act: async (fn) => {
          try {
            return await fn();
          } catch (e) {
            toast((e as Error).message, true);
            return undefined;
          }
        },
        openRun: (id) => go(hashWith("run", id)),
        openSettings: () => setSettings(true),
      },
    [snap, rev, toast],
  );
  const [a, slug, b, c] = route.parts;
  const project = a === "p" ? snap?.projects.find((p) => p.slug === slug) : undefined;
  // A project's tabs are one page: switching between them keeps the scroll position.
  const detail = b === "t" || b === "a";
  useScrollMemory(route.parts.slice(0, a === "p" && !detail ? 2 : 4).join("/"));
  const heading = !a ? "Today"
    : a === "shuttle" ? "Shuttle"
    : a === "activity" ? "Activity"
    : a === "automations" ? "Automations"
    : a === "usage" ? "Usage"
    : !project ? ""
    : b === "t" && c ? `${c} ${project.tasks.find((t) => t.id === c)?.title ?? ""} · ${project.name}`
    : b === "a" && c ? `${c} · ${project.name}`
    : project.name;
  useEffect(() => {
    document.title = heading ? `${heading.trim()} · Loom` : "Loom";
  }, [heading]);

  if (!snap || !ctx) return <div className="boot">{connected ? "" : "Waiting for the Loom server…"}</div>;

  const runId = route.query.get("run");
  const edit = route.query.has("edit");
  let view;
  if (!a) view = <Today />;
  else if (a === "shuttle") view = <div className="page shuttle-page"><Shuttle /></div>;
  else if (a === "activity") view = <Activity />;
  else if (a === "automations") view = <Automations />;
  else if (a === "usage") view = <Usage />;
  else if (a === "p" && project && b === "t" && c) view = <TaskPage project={project} id={c} edit={edit} />;
  else if (a === "p" && project && b === "a" && c) view = <DocPage project={project} name={c} edit={edit} />;
  else if (a === "p" && project) view = <ProjectPage project={project} tab={b ?? "tasks"} />;
  else view = <div className="page"><p className="empty">Nothing here. <a href="#/">Back to Today</a></p></div>;

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <Rail snap={snap} current={route.parts} onSettings={() => setSettings(true)} />
        <div className="main">
          {!connected && <p className="banner amber">Disconnected from the Loom server. Reconnecting…</p>}
          {view}
        </div>
      </div>
      {runId && <RunDrawer id={runId} onClose={() => go(hashWith("run", null))} />}
      {settings && <Settings onClose={() => setSettings(false)} />}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.bad ? " bad" : ""}`} title="Dismiss" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

startTelemetry();
createRoot(document.getElementById("root")!).render(<App />);
