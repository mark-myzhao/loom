import { useEffect, useMemo, useState } from "react";
import type { ProjectSnapshot, RunMeta, Task, TaskDetail, TimelineEvent } from "../../server/types";
import { PRIORITIES, TASK_STATUSES } from "../../server/types";
import { api, buildTree, descendants, enc, go, hashWith, isLive, onSubmitKey, stamp, STATUS_LABEL, taskHref, useApp, useData } from "../lib";
import { Empty, Markdown, Progress, Ring, RunRow, TaskRow } from "../ui";
import { ArtifactAdd, ArtifactCompose, ArtifactRows } from "./Project";

const AUTHOR: Record<string, string> = { me: "You", claude: "Claude", agent: "Agent" };

function Event({ ev }: { ev: TimelineEvent }) {
  const { openRun } = useApp();
  // A trailing "run <id>" links to the transcript.
  const m = /^(.*?)(?:\s*·\s*)?run (\d{14}-[a-z0-9]{4})$/.exec(ev.detail);
  const detail = m ? m[1]! : ev.detail;
  const who = AUTHOR[ev.by] ?? ev.by;
  return (
    <li className={`event ev-${ev.type} by-${ev.by}`}>
      <p className="event-head">
        <strong>{who}</strong>{" "}
        {ev.type === "comment" ? "commented" : ev.type === "created" ? "created this task" : ev.type === "status" ? "changed status" : ev.type === "field" ? "changed" : ev.type}
        {detail && <span className="event-detail"> {detail}</span>}
        {m && <> · <button className="link" onClick={() => openRun(m[2]!)}>transcript</button></>}
        <time title={ev.time}>{ev.time ? stamp(ev.time) : ""}</time>
      </p>
      {ev.body && <Markdown text={ev.body} className="event-body" />}
    </li>
  );
}

function Delegate({ p, task, runs }: { p: ProjectSnapshot; task: Task; runs: RunMeta[] }) {
  const { snap, act, openRun } = useApp();
  const registered = p.repos.find((r) => r.name === task.repo) ?? p.repos[0];
  const [path, setPath] = useState(registered?.path ?? "");
  const [instructions, setInstructions] = useState("");
  const [worktree, setWorktree] = useState(snap.config.agent.useWorktree);
  const live = runs.find((r) => r.kind === "task" && isLive(r));
  useEffect(() => {
    if (!path && registered) setPath(registered.path);
  }, [registered?.path]);
  const start = async () => {
    const run = await act(() => api<RunMeta>("POST", `/projects/${enc(p.slug)}/tasks/${task.id}/delegate`, { repoPath: path, instructions, worktree }));
    if (run) {
      setInstructions("");
      openRun(run.id);
    }
  };
  if (live) return <button className="is-live wide" onClick={() => openRun(live.id)}>Agent working… view</button>;
  return (
    <div className="delegate">
      {p.repos.length > 0 && (
        <select value={p.repos.some((r) => r.path === path) ? path : ""} onChange={(e) => setPath(e.target.value)} aria-label="Codebase">
          <option value="">Another path…</option>
          {p.repos.map((r) => <option key={r.name} value={r.path}>{r.name}</option>)}
        </select>
      )}
      {!p.repos.some((r) => r.path === path) && (
        <input value={path} placeholder="/absolute/path/to/checkout" onChange={(e) => setPath(e.target.value)} />
      )}
      <textarea rows={2} value={instructions} placeholder="Extra instructions (optional)" onChange={(e) => setInstructions(e.target.value)} />
      <label className="check"><input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} /> Separate git worktree</label>
      <button className="primary wide" disabled={!path.trim()} onClick={start}>Delegate to an agent</button>
    </div>
  );
}

export function TaskPage({ project: p, id, edit }: { project: ProjectSnapshot; id: string; edit: boolean }) {
  const { act } = useApp();
  const base = `/projects/${enc(p.slug)}/tasks/${enc(id)}`;
  const { data, error } = useData<TaskDetail>(base);
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [sub, setSub] = useState("");
  const tree = useMemo(() => buildTree(p.tasks), [p.tasks]);

  useEffect(() => {
    setTitle(null);
    setBody(null);
    setComment("");
  }, [p.slug, id]);
  // `?edit` (a task just created) opens the description for editing once it has loaded.
  useEffect(() => {
    if (edit && data && body === null) {
      setBody(data.task.body);
      history.replaceState(null, "", hashWith("edit", null));
    }
  }, [edit, !!data]);

  if (error) return <div className="page wide"><p className="banner bad">{error}</p><a href={`#/p/${enc(p.slug)}`}>← {p.name}</a></div>;
  if (!data) return <div className="page wide" />;
  const { task } = data;
  const patch = (fields: object) => act(() => api("PATCH", base, fields));
  const saveTitle = async () => {
    if (title?.trim() && title.trim() !== task.title) await patch({ title });
    setTitle(null);
  };
  const saveBody = async () => {
    if (body !== null && body !== task.body) await patch({ body });
    setBody(null);
  };
  const send = async (done: boolean) => {
    if (!comment.trim() && !done) return;
    if (await act(() => api("POST", `${base}/comments`, { text: comment, done }))) setComment("");
  };
  const addSub = async () => {
    if (!sub.trim()) return;
    if (await act(() => api("POST", `/projects/${enc(p.slug)}/tasks`, { title: sub, parent: id }))) setSub("");
  };
  const remove = async () => {
    if (!confirm(`Delete ${id}? It moves to the trash, and its subtasks move up a level.`)) return;
    if (await act(() => api("DELETE", base))) go(`#/p/${enc(p.slug)}`);
  };
  const below = new Set(descendants(tree, id).map((d) => d.id));
  const kids = descendants(tree, id);

  return (
    <div className="page wide">
      <p className="label crumbs">
        <a href={`#/p/${enc(p.slug)}`}>{p.name}</a>
        {data.ancestors.map((a) => <span key={a.id}> / <a href={taskHref(p.slug, a.id)}>{a.id} {a.title}</a></span>)}
        <span> / {id}</span>
      </p>

      <div className="task-layout">
        <main>
          <div className="task-title">
            <Ring status={task.status} size={22} />
            {title !== null ? (
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => (e.key === "Enter" ? saveTitle() : e.key === "Escape" && setTitle(null))} />
            ) : (
              <h1 title="Click to rename" onClick={() => setTitle(task.title)}>{task.title}</h1>
            )}
          </div>

          {data.ancestors.length > 0 && (
            <details className="inherited">
              <summary className="label">Shared context from {data.ancestors.map((a) => a.id).join(" › ")}</summary>
              {data.ancestors.map((a) => (
                <div key={a.id}>
                  <p className="label"><a href={taskHref(p.slug, a.id)}>{a.id} · {a.title}</a></p>
                  {a.context ? <Markdown text={a.context} slug={p.slug} /> : <p className="muted">No context written.</p>}
                </div>
              ))}
            </details>
          )}

          <section className="task-body shadowed">
            {body !== null ? (
              <>
                <textarea autoFocus rows={Math.max(12, body.split("\n").length + 2)} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onSubmitKey(saveBody)} />
                <div className="btn-row end">
                  <button onClick={() => setBody(null)}>Cancel</button>
                  <button className="primary" onClick={saveBody}>Save</button>
                </div>
              </>
            ) : (
              <>
                <button className="link edit-btn" onClick={() => setBody(task.body)}>Edit</button>
                {task.body.trim() ? (
                  <Markdown text={task.body} slug={p.slug} onCheck={(index, checked) => act(() => api("POST", `${base}/checklist`, { index, checked }))} />
                ) : (
                  <p className="muted">No description.</p>
                )}
              </>
            )}
          </section>

          <section className="group">
            <h3 className="label">
              Subtasks
              {kids.length > 0 && <Progress done={kids.filter((k) => k.status === "done").length} total={kids.length} title="Done, at every level" />}
            </h3>
            {data.children.map((c) => <TaskRow key={c.id} slug={p.slug} task={c} tree={tree} />)}
            <input className="add-line" value={sub} placeholder="Add a subtask…" onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSub()} />
          </section>

          <section className="group">
            <div className="section-head">
              <h3 className="label">Documents</h3>
              <ArtifactAdd slug={p.slug} taskId={id} />
            </div>
            <ArtifactRows slug={p.slug} items={data.artifacts} />
            {[...data.ancestors].reverse().map((a) => <ArtifactRows key={a.id} slug={p.slug} items={a.artifacts} inherited={a.id} />)}
            {!data.artifacts.length && !data.ancestors.some((a) => a.artifacts.length) && <Empty>No documents. Research, comparisons and anything too long for the description go here.</Empty>}
            <ArtifactCompose slug={p.slug} taskId={id} />
          </section>

          <section className="group">
            <h3 className="label">Timeline</h3>
            <ul className="timeline">
              {data.timeline.map((ev, i) => <Event key={i} ev={ev} />)}
            </ul>
            <div className="compose">
              <textarea rows={2} value={comment} placeholder="Comment…" onChange={(e) => setComment(e.target.value)} onKeyDown={onSubmitKey(() => send(false))} />
              <span className="btn-row">
                <button disabled={!comment.trim()} onClick={() => send(false)}>Comment</button>
                {task.status !== "done" && <button onClick={() => send(true)}>{comment.trim() ? "Comment & mark done" : "Mark done"}</button>}
              </span>
            </div>
          </section>
        </main>

        <aside className="task-side">
          <label>Status
            <select value={task.status} onChange={(e) => patch({ status: e.target.value })}>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label>Priority
            <select value={task.priority} onChange={(e) => patch({ priority: e.target.value })}>
              {PRIORITIES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
            </select>
          </label>
          <label>Due
            <input type="date" value={task.due ?? ""} onChange={(e) => patch({ due: e.target.value })} />
          </label>
          <label>Parent
            <select value={task.parent ?? ""} onChange={(e) => patch({ parent: e.target.value })}>
              <option value="">None</option>
              {p.tasks.filter((t) => t.id !== id && !below.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.id} {t.title.slice(0, 40)}</option>)}
            </select>
          </label>
          <label>Codebase
            <select value={task.repo ?? ""} onChange={(e) => patch({ repo: e.target.value })}>
              <option value="">None</option>
              {task.repo && !p.repos.some((r) => r.name === task.repo) && <option>{task.repo}</option>}
              {p.repos.map((r) => <option key={r.name}>{r.name}</option>)}
            </select>
          </label>
          {task.source && <p className="side-fact">Source <a href={task.source} target="_blank" rel="noopener noreferrer">{task.source.replace(/^https?:\/\//, "").slice(0, 34)}</a></p>}
          <p className="side-fact">Created {task.created ?? "?"} · updated {task.updated ?? "?"}</p>

          <h3 className="label">Agent</h3>
          <Delegate p={p} task={task} runs={data.runs} />
          {data.runs.map((r) => <RunRow key={r.id} run={r} />)}

          <button className="link danger" onClick={remove}>Delete task</button>
        </aside>
      </div>
    </div>
  );
}
