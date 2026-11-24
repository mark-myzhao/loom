import { useEffect, useMemo, useRef, useState } from "react";
import type { RunMeta } from "../../server/types";
import { api, buildTree, enc, GROUPS, isLive, onSubmitKey, sortTasks, useApp } from "../lib";
import { Empty, RunList, RunRow, TaskRow } from "../ui";
import { Transcript, useRunLines } from "./RunDrawer";

/** The Shuttle: Loom's resident agent and the owner's one conversation with it. */
function Shuttle() {
  const { snap, act, openRun } = useApp();
  const [text, setText] = useState("");
  const [fresh, setFresh] = useState(false);
  const run = fresh ? undefined : snap.shuttle;
  const live = !!run && isLive(run);
  const lines = useRunLines(run?.id, live);
  const feed = useRef<HTMLDivElement>(null);
  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight });
  }, [lines.length, live]);
  const send = async () => {
    if (!text.trim() || live) return;
    if (await act(() => api<RunMeta>("POST", "/shuttle", { text, fresh }))) {
      setText("");
      setFresh(false);
    }
  };
  return (
    <section className="shuttle shadowed">
      <header className="shuttle-head">
        <h2>Shuttle</h2>
        <span className="hint">routes your notes, questions and work to the right place, and reports back</span>
        {run && (
          <span className="btn-row end">
            <button className="link" onClick={() => openRun(run.id)}>Details</button>
            <button className="link" onClick={() => setFresh(true)}>New conversation</button>
          </span>
        )}
      </header>
      <div className="shuttle-feed" ref={feed}>
        {run ? (
          <Transcript lines={lines} chat />
        ) : (
          <p className="empty">
            Paste meeting notes or links, ask what needs you, or say “have an agent fix T-004”. Shuttle files notes, answers from your
            projects, and hands bigger work to background runs. It remembers standing instructions in SHUTTLE.md.
          </p>
        )}
        {live && <p className="sysline"><span className="pill live run-running">{run.status}</span></p>}
      </div>
      <div className="compose">
        <textarea rows={2} value={text} aria-label="Message the Shuttle" placeholder={live ? "Shuttle is working…" : "Tell the Shuttle…"} onChange={(e) => setText(e.target.value)} onKeyDown={onSubmitKey(send)} />
        <button className="primary" disabled={!text.trim() || live} onClick={send}>Send</button>
      </div>
    </section>
  );
}

export function Today() {
  const { snap } = useApp();
  const active = snap.projects.filter((p) => p.status === "active");
  // The Shuttle's own run shows in its panel, not here.
  const live = snap.runs.filter((r) => isLive(r) && r.kind !== "shuttle");
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
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="label">Today</p>
          <h1>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h1>
        </div>
      </header>

      <Shuttle />

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
              ? "Nothing open. Tell the Shuttle what you are working on, or add a task on a project."
              : "No projects yet. Give the Shuttle your first notes and it will create one, or use “New project” in the rail."}
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
                  <p className="clamp">{p.error ? p.error : p.summary || "No summary yet."}</p>
                  <p className="card-meta">
                    <span>{p.tasks.filter((t) => t.status !== "done").length} open</span>
                    {n("review") > 0 && <span className="c-slate">{n("review")} to review</span>}
                    {n("blocked") > 0 && <span className="c-bad">{n("blocked")} blocked</span>}
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
