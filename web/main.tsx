import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Project, Snapshot } from "../server/types";
import { api, Ctx, enc, go, hashWith, isLive, openCount, useApp, useRoute, type AppCtx } from "./lib";
import { Wordmark } from "./ui";
import { DocPage } from "./views/Doc";
import { ProjectPage } from "./views/Project";
import { RunDrawer, Settings } from "./views/RunDrawer";
import { TaskPage } from "./views/TaskPage";
import { Activity, Today } from "./views/Today";

function Rail({ snap, current, onSettings }: { snap: Snapshot; current: string[]; onSettings: () => void }) {
  const { act } = useApp();
  const [name, setName] = useState<string | null>(null);
  const open = snap.projects.filter((p) => p.status !== "done");
  const finished = snap.projects.filter((p) => p.status === "done");
  const create = async () => {
    if (!name?.trim()) return setName(null);
    const p = await act(() => api<Project>("POST", "/projects", { name }));
    if (p) {
      setName(null);
      go(`#/p/${enc(p.slug)}`);
    }
  };
  const item = (p: Snapshot["projects"][number]) => {
    const live = snap.runs.some((r) => r.project === p.slug && isLive(r));
    return (
      <a key={p.slug} href={`#/p/${enc(p.slug)}`} className={current[0] === "p" && current[1] === p.slug ? "on" : ""}>
        <span className={`dot st-${p.status}${live ? " live" : ""}`} />
        <span className="rail-name">{p.name}</span>
        {openCount(p) > 0 && <span className="count">{openCount(p)}</span>}
      </a>
    );
  };
  return (
    <nav className="rail">
      <a className="brand" href="#/"><Wordmark /></a>
      <a href="#/" className={current.length === 0 ? "on" : ""}>Today</a>
      <a href="#/activity" className={current[0] === "activity" ? "on" : ""}>
        Activity
        {snap.runs.some(isLive) && <span className="dot live st-active" />}
      </a>
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
        <p>{snap.config.schedule.enabled ? `Daily sync at ${snap.config.schedule.time}` : "Daily sync off"}</p>
        <p>Last ran {snap.lastDailySync ?? "never"}</p>
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
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [settings, setSettings] = useState(false);
  const seq = useRef(0);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  const refresh = useCallback(() => {
    const mine = ++seq.current;
    api<Snapshot>("GET", "/state").then(
      (s) => mine === seq.current && setSnap(s),
      (e) => toast((e as Error).message),
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
            toast((e as Error).message);
            return undefined;
          }
        },
        openRun: (id) => go(hashWith("run", id)),
        openSettings: () => setSettings(true),
      },
    [snap, rev, toast],
  );
  if (!snap || !ctx) return <div className="boot">{connected ? "" : "Waiting for the Loom server…"}</div>;

  const [a, slug, b, c] = route.parts;
  const project = a === "p" ? snap.projects.find((p) => p.slug === slug) : undefined;
  const runId = route.query.get("run");
  const edit = route.query.has("edit");
  let view;
  if (!a) view = <Today />;
  else if (a === "activity") view = <Activity />;
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
        {toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
