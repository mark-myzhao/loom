import { useEffect, useMemo, useState } from "react";
import type { ProjectSnapshot, RunMeta, Task, TaskDetail, TimelineEvent } from "../../server/types";
import { PRIORITIES, TASK_STATUSES } from "../../server/types";
import { ago, api, buildTree, day, descendants, enc, go, hashWith, isLive, onSubmitKey, stamp, STATUS_LABEL, taskHref, useApp, useData } from "../lib";
import { DateInput, Select } from "../controls";
import { editable, Empty, Markdown, Progress, RunRow, StatusChip, TaskRow } from "../ui";
import { ArtifactRows, ArtifactsHead } from "./Project";

const AUTHOR: Record<string, string> = { me: "You", claude: "Claude", agent: "Agent", shuttle: "Shuttle" };

function Event({ ev, slug }: { ev: TimelineEvent; slug: string }) {
  const { openRun } = useApp();
  // A trailing "run <id>" links to the transcript.
  const m = /^(.*?)(?:\s*·\s*)?run (\d{14}-[a-z0-9]{4})$/.exec(ev.detail);
  const detail = m ? m[1]! : ev.detail;
  const who = AUTHOR[ev.by] ?? ev.by;
  const head = (
    <p className="event-head">
      <strong>{who}</strong>{" "}
      {ev.type === "comment" ? "commented" : ev.type === "note" ? "sent a note" : ev.type === "created" ? "opened this task" : ev.type === "status" ? "changed status" : ev.type === "field" ? "changed" : ev.type}
      {detail && <span className="event-detail"> {detail}</span>}
      {m && <> · <button className="link" onClick={() => openRun(m[2]!)}>transcript</button></>}
      <time title={ev.time}>{!ev.time ? "" : ev.body ? ago(ev.time) : stamp(ev.time)}</time>
    </p>
  );
  // Anything with a body is a card; the rest are one-line marks on the line.
  return (
    <li className={`event ev-${ev.type} by-${/^T-\d+\.\d+$/.test(ev.by) ? "agent" : ev.by}${ev.body ? "" : " event-line"}`}>
      {ev.body ? <article className="event-card">{head}<Markdown text={ev.body} slug={slug} className="event-body" /></article> : head}
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
  return (
    <section className="delegate">
      <h3 className="label">Delegate to Claude Code</h3>
      <label>Repository
        {p.repos.length > 0 && (
          <Select value={p.repos.some((r) => r.path === path) ? path : ""} onChange={setPath} options={[{ value: "", label: "Another path…" }, ...p.repos.map((r) => ({ value: r.path, label: r.name }))]} />
        )}
        <input value={path} placeholder="/absolute/path/to/checkout" spellCheck={false} onChange={(e) => setPath(e.target.value)} />
      </label>
      <label>Extra instructions
        <textarea rows={3} value={instructions} placeholder="Constraints, where to start, whether to open a draft PR…" onChange={(e) => setInstructions(e.target.value)} />
      </label>
      <label className="check"><input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} /> Separate git worktree</label>
      {live && <button className="wide live" onClick={() => openRun(live.id)}>Agent is working…</button>}
      <button className="primary wide" disabled={!path.trim()} onClick={start}>{runs.some((r) => r.kind === "task") ? "Start another Thread" : "Delegate task"}</button>
      <small>The agent gets this task and the project memory, commits locally, and reports back in the timeline. It does not push unless told to.</small>
    </section>
  );
}

export function TaskPage({ project: p, id, edit }: { project: ProjectSnapshot; id: string; edit: boolean }) {
  const { act, openRun } = useApp();
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

  if (error) return <div className="page"><p className="banner bad">{error}</p><a href={`#/p/${enc(p.slug)}`}>← {p.name}</a></div>;
  if (!data) return <div className="page" />;
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
  // A comment is a note to the task's Threads; one that closes the task is only recorded, so it wakes none.
  const send = async (done: boolean) => {
    if (!comment.trim() && !done) return;
    const sent = await act(() => (done ? api("POST", `${base}/comments`, { text: comment, done }) : api("POST", `${base}/note`, { text: comment })));
    if (sent) setComment("");
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
  const parent = task.parent ? tree.byId.get(task.parent) : undefined;
  const working = data.runs.find((r) => r.kind === "task" && isLive(r));

  return (
    <div className="page">
      <p className="label crumbs">
        <a href={`#/p/${enc(p.slug)}`}>{p.name}</a>
        {data.ancestors.map((a) => <span key={a.id}> / <a href={taskHref(p.slug, a.id)} title={a.title}>{a.id}</a></span>)}
        <span> / {id}</span>
      </p>

      <header className="task-head">
        {title !== null ? (
          <input autoFocus aria-label="Task title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => (e.key === "Enter" ? saveTitle() : e.key === "Escape" && setTitle(null))} />
        ) : (
          <h1><span {...editable(() => setTitle(task.title), "Click to rename")}>{task.title}</span></h1>
        )}
        <p className="task-meta">
          <StatusChip status={task.status} />
          {task.created && <span title={task.created}>opened {day(task.created)}</span>}
          <Progress done={task.checked} total={task.total} title="Checklist" />
          {parent && <span>subtask of <a href={taskHref(p.slug, parent.id)}>{parent.id} {parent.title}</a></span>}
        </p>
        {working && <button className="pill run-running" onClick={() => openRun(working.id)}><span className="dot live" />agent working</button>}
      </header>

      <div className="task-layout">
        <main>
          {data.ancestors.length > 0 && (
            <details className="inherited">
              <summary>
                <strong>Shared context from</strong>{" "}
                {data.ancestors.map((a, i) => <span key={a.id}>{i > 0 && " › "}<a href={taskHref(p.slug, a.id)}><strong>{a.id}</strong></a> {a.title}</span>)}
              </summary>
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
                <div className="card-head">
                  <h3 className="label">Description</h3>
                  <button className="link" onClick={() => setBody(task.body)}>Edit</button>
                </div>
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
            <input className="add-line" value={sub} aria-label="Add a subtask" placeholder="Add a subtask, then Enter" onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSub()} />
          </section>

          {data.linkedFrom.length > 0 && (
            <section className="group">
              <h3 className="label">Linked from</h3>
              <ul className="linked-from">
                {data.linkedFrom.map((l, i) => <li key={i}><Markdown text={`[[${l.from}]] · ${l.line}`} slug={p.slug} /></li>)}
              </ul>
            </section>
          )}

          <section className="group">
            <ArtifactsHead slug={p.slug} taskId={id} count={data.artifacts.length + data.ancestors.reduce((n, a) => n + a.artifacts.length, 0)} />
            <ArtifactRows slug={p.slug} items={data.artifacts} />
            {[...data.ancestors].reverse().map((a) => <ArtifactRows key={a.id} slug={p.slug} items={a.artifacts} inherited={a.id} />)}
            {!data.artifacts.length && !data.ancestors.some((a) => a.artifacts.length) && <Empty>No artifacts. Research, comparisons and anything too long for the description go here.</Empty>}
          </section>

          <section className="group">
            <h3 className="label">Timeline</h3>
            <ul className="timeline">
              {data.timeline.map((ev, i) => <Event key={i} ev={ev} slug={p.slug} />)}
            </ul>
            <div className="compose">
              <textarea rows={2} value={comment} aria-label="Note" placeholder="Note for this task's Threads…" onChange={(e) => setComment(e.target.value)} onKeyDown={onSubmitKey(() => send(false))} />
              <span className="btn-row">
                <button disabled={!comment.trim()} onClick={() => send(false)}>Send note</button>
                {task.status !== "done" && <button onClick={() => send(true)}>{comment.trim() ? "Comment & mark done" : "Mark done"}</button>}
              </span>
            </div>
          </section>
        </main>

        <aside className="task-side">
          <label>Status
            <Select value={task.status} onChange={(status) => patch({ status })} options={TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
          </label>
          <label>Priority
            <Select value={task.priority} onChange={(priority) => patch({ priority })} options={PRIORITIES.map((s) => ({ value: s, label: s.toUpperCase() }))} />
          </label>
          <label>Due
            <DateInput value={task.due ?? ""} onChange={(due) => patch({ due })} />
          </label>
          <label>Parent
            <Select value={task.parent ?? ""} onChange={(parent) => patch({ parent })} options={[{ value: "", label: "None" }, ...p.tasks.filter((t) => t.id !== id && !below.has(t.id)).map((t) => ({ value: t.id, label: `${t.id} ${t.title.slice(0, 40)}` }))]} />
          </label>
          <label>Codebase
            <Select value={task.repo ?? ""} onChange={(repo) => patch({ repo })} options={[{ value: "", label: "None" }, ...(task.repo && !p.repos.some((r) => r.name === task.repo) ? [{ value: task.repo }] : []), ...p.repos.map((r) => ({ value: r.name }))]} />
          </label>
          <hr />
          {task.source && (
            <div className="side-source">
              <h3 className="label">Source</h3>
              {/^https?:/.test(task.source) ? <a href={task.source} target="_blank" rel="noopener noreferrer">{task.source}</a> : <span className="side-fact">{task.source}</span>}
            </div>
          )}

          <Delegate p={p} task={task} runs={data.runs} />
          {data.runs.map((r) => <RunRow key={r.id} run={r} />)}

          <p className="side-fact" title={task.updated}>Updated {task.updated ? day(task.updated) : "?"}</p>
          <button className="link danger" onClick={remove}>Delete task</button>
        </aside>
      </div>
    </div>
  );
}
