import { useMemo, useState } from "react";
import type { RunMeta } from "../../server/types";
import { ago, api, buildTree, enc, GROUPS, isLive, onSubmitKey, sortTasks, useApp } from "../lib";
import { Empty, RunList, RunRow, TaskRow } from "../ui";

export function DropBox() {
  const { snap, act, openRun } = useApp();
  const [text, setText] = useState("");
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  const active = snap.projects.filter((p) => p.status === "active" && !p.error);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const run = await act(() => api<RunMeta>("POST", "/ingest", { text, project: project || undefined }));
    setBusy(false);
    if (run) {
      setText("");
      openRun(run.id);
    }
  };
  return (
    <div className="dropbox shadowed">
      <textarea
        rows={3}
        value={text}
        placeholder="Drop meeting notes or links here. Claude files them under the right project and pulls out your action items."
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onSubmitKey(submit)}
      />
      <div className="dropbox-foot">
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          <option value="">Let Claude pick the project</option>
          {active.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
        <span className="hint">⌘↵</span>
        <button className="primary" disabled={!text.trim() || busy} onClick={submit}>{busy ? "Starting…" : "Hand to Claude"}</button>
      </div>
    </div>
  );
}

export function Today() {
  const { snap, act, toast } = useApp();
  const active = snap.projects.filter((p) => p.status === "active");
  const live = snap.runs.filter(isLive);
  const open = useMemo(
    () =>
      GROUPS.filter((g) => g.status !== "done").flatMap((g) =>
        active.flatMap((p) => {
          const tree = buildTree(p.tasks);
          return sortTasks(p.tasks.filter((t) => t.status === g.status)).map((task) => ({ p, task, tree }));
        }).sort((a, b) => a.task.priority.localeCompare(b.task.priority)),
      ),
    [snap],
  );
  const syncAll = async () => {
    const runs = await act(() => api<RunMeta[]>("POST", "/sync-all"));
    if (runs) toast(runs.length ? `Syncing ${runs.length} project${runs.length === 1 ? "" : "s"}.` : "No active project has sources or pending notes to sync.");
  };
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="label">Today</p>
          <h1>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h1>
        </div>
        <button onClick={syncAll}>Sync all projects</button>
      </header>

      <DropBox />

      {live.length > 0 && (
        <section className="group">
          <h3 className="label">Running now <span className="count">{live.length}</span></h3>
          {live.map((r) => <RunRow key={r.id} run={r} projectName={snap.projects.find((p) => p.slug === r.project)?.name} />)}
        </section>
      )}

      <section className="group">
        <h3 className="label">Open tasks <span className="count">{open.length}</span></h3>
        {open.length ? (
          open.map(({ p, task, tree }) => <TaskRow key={`${p.slug}/${task.id}`} slug={p.slug} task={task} tree={tree} showProject={p.name} />)
        ) : (
          <Empty>
            {snap.projects.length
              ? "Nothing open. Drop in notes above, or add a task on a project."
              : "No projects yet. Drop in your first notes above and Claude will create one, or use “New project” in the rail."}
          </Empty>
        )}
      </section>

      {active.length > 0 && (
        <section className="group">
          <h3 className="label">Active projects <span className="count">{active.length}</span></h3>
          <div className="grid">
            {active.map((p) => {
              const n = (s: string) => p.tasks.filter((t) => t.status === s).length;
              return (
                <a key={p.slug} className="card project-card" href={`#/p/${enc(p.slug)}`}>
                  <h4>{p.name}</h4>
                  <p className="clamp">{p.error ? p.error : p.summary || "No summary yet. A sync writes one."}</p>
                  <p className="card-meta">
                    <span>{p.tasks.filter((t) => t.status !== "done").length} open</span>
                    {n("review") > 0 && <span className="c-slate">{n("review")} to review</span>}
                    {n("blocked") > 0 && <span className="c-bad">{n("blocked")} blocked</span>}
                    <span className="right">synced {ago(p.lastSyncedAt)}</span>
                  </p>
                </a>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export function Activity() {
  const { snap } = useApp();
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="label">Every run, newest first</p>
          <h1>Activity</h1>
        </div>
      </header>
      <RunList runs={snap.runs} withProject />
    </div>
  );
}
