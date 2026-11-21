import { useRef, useState } from "react";
import type { Artifact, ArtifactDetail, InboxNote, MemoryEntry, ProjectSnapshot, RunMeta, Task } from "../../server/types";
import { PROJECT_STATUSES } from "../../server/types";
import { ago, api, docHref, enc, go, isLive, onSubmitKey, stamp, taskHref, useApp, useData } from "../lib";
import { editable, Empty, KindBadge, Markdown, RunList, TaskGroups } from "../ui";
import { Graph } from "./Graph";

const TABS = ["tasks", "graph", "artifacts", "memory", "context", "activity"] as const;
type Tab = (typeof TABS)[number];

export function ProjectPage({ project: p, tab }: { project: ProjectSnapshot; tab: string }) {
  const { snap, act, openRun } = useApp();
  const base = `/projects/${enc(p.slug)}`;
  const current: Tab = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : "tasks";
  const runs = snap.runs.filter((r) => r.project === p.slug);
  const syncing = runs.find((r) => r.kind === "sync" && isLive(r));
  const [question, setQuestion] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const sync = async () => {
    if (syncing) return openRun(syncing.id);
    const run = await act(() => api<RunMeta>("POST", `${base}/sync`));
    if (run) openRun(run.id);
  };
  const ask = async () => {
    if (!question.trim()) return;
    const run = await act(() => api<RunMeta>("POST", `${base}/ask`, { text: question }));
    if (run) {
      setQuestion("");
      openRun(run.id);
    }
  };
  const saveSummary = async () => {
    if (editing !== null && editing !== p.summary) await act(() => api("PATCH", base, { summary: editing }));
    setEditing(null);
  };
  const counts: Partial<Record<Tab, number>> = {
    tasks: p.tasks.filter((t) => t.status !== "done").length,
    context: p.sources.length + p.repos.length,
    activity: runs.length,
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="label">
            Project ·{" "}
            <select className={`inline-select st-${p.status}`} value={p.status} onChange={(e) => act(() => api("PATCH", base, { status: e.target.value }))} aria-label="Project status">
              {PROJECT_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>{" "}
            · synced {ago(p.lastSyncedAt)}
          </p>
          <h1>{p.name}</h1>
        </div>
        <button onClick={sync} className={syncing ? "is-live" : ""}>{syncing ? "Syncing… view" : "Sync now"}</button>
      </header>

      {p.error && <p className="banner bad">This project’s metadata is unreadable: {p.error}. Fix <code>projects/{p.slug}/project.json</code> in an editor.</p>}

      {editing !== null ? (
        <textarea
          className="summary-edit" autoFocus rows={3} value={editing}
          onChange={(e) => setEditing(e.target.value)} onBlur={saveSummary}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(null);
            else onSubmitKey(saveSummary)(e);
          }}
        />
      ) : (
        <p className={`summary${p.summary ? "" : " muted"}`}>
          <span {...editable(() => !p.error && setEditing(p.summary), "Click to edit the summary")}>
            {p.summary || "No summary yet. Click to write one, or let a sync do it."}
          </span>
        </p>
      )}

      <div className="askbox">
        <input
          value={question} aria-label={`Ask Claude about ${p.name}`} placeholder={`Ask Claude about ${p.name}, or tell it what to update…`}
          onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()}
        />
        <button className="primary" disabled={!question.trim()} onClick={ask}>Ask</button>
      </div>

      <nav className="tabs">
        {TABS.map((t) => (
          <a key={t} className={t === current ? "on" : ""} aria-current={t === current ? "page" : undefined} href={`#/p/${enc(p.slug)}${t === "tasks" ? "" : `/${t}`}`}>
            {t[0]!.toUpperCase() + t.slice(1)}
            {counts[t] ? <span className="count">{counts[t]}</span> : null}
          </a>
        ))}
      </nav>

      {current === "tasks" && <TasksTab p={p} />}
      {current === "graph" && <Graph project={p} />}
      {current === "artifacts" && <ArtifactsTab slug={p.slug} />}
      {current === "memory" && <MemoryTab slug={p.slug} />}
      {current === "context" && <ContextTab p={p} />}
      {current === "activity" && <RunList runs={runs} />}
    </div>
  );
}

function TasksTab({ p }: { p: ProjectSnapshot }) {
  const { act } = useApp();
  const [title, setTitle] = useState("");
  const add = async () => {
    if (!title.trim()) return;
    const t = await act(() => api<Task>("POST", `/projects/${enc(p.slug)}/tasks`, { title }));
    if (t) {
      setTitle("");
      go(`${taskHref(p.slug, t.id)}?edit`);
    }
  };
  return (
    <>
      <input className="add-line" value={title} aria-label="Add a task" placeholder="Add a task, then Enter" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      {p.tasks.length ? (
        <TaskGroups slug={p.slug} tasks={p.tasks} />
      ) : (
        <Empty>No tasks yet. Type one above, or sync a source and Claude will pull out your action items.</Empty>
      )}
    </>
  );
}

// ---------- artifacts ----------

const ORIGIN: Record<string, { text: string; className: string }> = {
  generated: { text: "By Claude", className: " by-claude" },
  imported: { text: "Imported", className: " by-import" },
  written: { text: "By you", className: "" },
};

export function ArtifactRows({ slug, items, inherited }: { slug: string; items: Artifact[]; inherited?: string }) {
  return (
    <>
      {items.map((a) => (
        <a key={a.name} className="row doc-row" href={docHref(slug, a.name)}>
          <KindBadge kind={a.kind} />
          <span className="row-title">{a.title}</span>
          <span className="id">{a.name}</span>
          <span className="row-meta">
            {inherited ? <span>from {inherited}</span> : a.task && <span>{a.task}</span>}
            {a.origin && <span className={`tag${ORIGIN[a.origin]?.className ?? ""}`}>{ORIGIN[a.origin]?.text ?? a.origin}</span>}
            <span>{ago(a.modifiedAt)}</span>
          </span>
        </a>
      ))}
    </>
  );
}

/** The section heading with its three ways to add one: ask Claude (or import links), write a blank document, upload a file. */
export function ArtifactsHead({ slug, taskId, count }: { slug: string; taskId?: string; count?: number }) {
  const { act, toast, openRun } = useApp();
  const file = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [request, setRequest] = useState<string | null>(null);
  const base = `/projects/${enc(slug)}/artifacts`;
  const generate = async () => {
    if (!request?.trim()) return;
    const run = await act(() => api<RunMeta>("POST", `${base}/generate`, { text: request, taskId }));
    if (run) {
      setRequest(null);
      openRun(run.id);
    }
  };
  const upload = async (f?: File) => {
    if (!f) return;
    if (!/\.(md|html?)$/i.test(f.name)) return toast("Upload a .md or .html file.");
    const a = await act(async () => api<ArtifactDetail>("POST", base, { filename: f.name, content: await f.text(), task: taskId }));
    if (a) go(docHref(slug, a.name));
  };
  const create = async () => {
    if (!title?.trim()) return setTitle(null);
    const a = await act(() => api<ArtifactDetail>("POST", base, { title, task: taskId }));
    if (a) go(`${docHref(slug, a.name)}?edit`);
  };
  return (
    <>
      <div className="section-head">
        <h3 className="label">Artifacts{count ? <span className="count">{count}</span> : null}</h3>
        <span className="btn-row">
          <button className="link" onClick={() => setRequest(request === null ? "" : null)}>Have Claude write one</button>
          {title === null ? (
            <button className="link" onClick={() => setTitle("")}>New document</button>
          ) : (
            <input autoFocus value={title} placeholder="Document title, then Enter" onChange={(e) => setTitle(e.target.value)} onBlur={() => !title && setTitle(null)} onKeyDown={(e) => (e.key === "Enter" ? create() : e.key === "Escape" && setTitle(null))} />
          )}
          <button className="link" onClick={() => file.current?.click()}>Upload</button>
          <input ref={file} type="file" accept=".md,.html,.htm,text/markdown,text/html" hidden onChange={(e) => (upload(e.target.files?.[0]), (e.target.value = ""))} />
        </span>
      </div>
      {request !== null && (
        <div className="compose boxed">
          <textarea
            autoFocus rows={2} value={request} onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => (e.key === "Escape" ? setRequest(null) : onSubmitKey(generate)(e))}
            placeholder={taskId ? `Describe a document for ${taskId}, or paste a link to import…` : "Describe a document to write, or paste a link to import…"}
          />
          <button className="primary" disabled={!request.trim()} onClick={generate}>Hand to Claude</button>
        </div>
      )}
    </>
  );
}

function ArtifactsTab({ slug }: { slug: string }) {
  const { data } = useData<Artifact[]>(`/projects/${enc(slug)}/artifacts`);
  return (
    <>
      <ArtifactsHead slug={slug} count={data?.length} />
      {data && (data.length ? <ArtifactRows slug={slug} items={data} /> : <Empty>No artifacts yet. Ask Claude for one, upload a file, or write one. Anything too long for a task belongs here.</Empty>)}
    </>
  );
}

// ---------- memory ----------

const MEMORY_TYPES = ["project", "decision", "people", "reference", "note"];
const MEMORY_HEAD: Record<string, [label: string, hint: string]> = {
  project: ["Project", "What it is for, goals, scope, hard constraints"],
  decision: ["Decisions", "Choices made, and why"],
  people: ["People", "Who owns or decides what"],
  reference: ["Reference", "Where things live"],
  note: ["Notes", "Everything else worth keeping"],
};

function MemoryForm({ slug, entry, onDone }: { slug: string; entry?: MemoryEntry; onDone: () => void }) {
  const { act } = useApp();
  const [f, setF] = useState({ name: entry?.name ?? "", description: entry?.description ?? "", type: entry?.type ?? "note", body: entry?.body ?? "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const base = `/projects/${enc(slug)}/memory`;
    const ok = await act(() => (entry ? api("PUT", `${base}/${enc(entry.file)}`, f) : api("POST", base, f)));
    if (ok) onDone();
  };
  return (
    <div className="memory-form shadowed">
      <div className="form-row">
        <input value={f.name} onChange={set("name")} placeholder="entry-name" disabled={!!entry} />
        <select value={f.type} onChange={set("type")}>{MEMORY_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
      </div>
      <input value={f.description} onChange={set("description")} placeholder="The fact, in one line" />
      <textarea rows={4} value={f.body} onChange={set("body")} onKeyDown={onSubmitKey(save)} placeholder="Why it matters, where it came from (with a date), how to apply it." />
      <div className="btn-row end">
        <button onClick={onDone}>Cancel</button>
        <button className="primary" disabled={!f.description.trim()} onClick={save}>{entry ? "Save" : "Remember"}</button>
      </div>
    </div>
  );
}

function MemoryTab({ slug }: { slug: string }) {
  const { act } = useApp();
  const { data } = useData<MemoryEntry[]>(`/projects/${enc(slug)}/memory`);
  const [editing, setEditing] = useState<string | null>(null);
  if (!data) return null;
  const forget = (e: MemoryEntry) =>
    confirm(`Forget “${e.name}”? It moves to the trash.`) && act(() => api("DELETE", `/projects/${enc(slug)}/memory/${enc(e.file)}`));
  return (
    <div className="memory">
      <div className="memory-intro">
        <p>What someone needs to know to work on this project: its purpose, decisions, people and where things live. Kept short on purpose. Detail belongs in tasks and their artifacts.</p>
        {editing !== "" && <button onClick={() => setEditing("")}>Remember something</button>}
      </div>
      {editing === "" && <MemoryForm slug={slug} onDone={() => setEditing(null)} />}
      {!data.length && editing !== "" && <Empty>No memory yet. Memory holds five to fifteen durable, project-wide facts: what the project is for, decisions, who owns what, where things live. Claude adds entries as it reads your sources.</Empty>}
      {MEMORY_TYPES.filter((t) => data.some((e) => e.type === t)).map((type) => (
        <section key={type} className="group">
          <h3 className="label">
            {MEMORY_HEAD[type]![0]}<span className="count">{data.filter((e) => e.type === type).length}</span>
            <span className="label-hint">{MEMORY_HEAD[type]![1]}</span>
          </h3>
          {data.filter((e) => e.type === type).map((e) =>
            editing === e.file ? (
              <MemoryForm key={e.file} slug={slug} entry={e} onDone={() => setEditing(null)} />
            ) : (
              <details key={e.file} className="memory-entry">
                <summary title="Show the detail">
                  <h4>{e.description || e.name}</h4>
                  <span className="id">{e.name}</span>
                </summary>
                <div className="memory-more">
                  {e.body && <Markdown text={e.body} slug={slug} />}
                  <span className="btn-row">
                    <button className="link" onClick={() => setEditing(e.file)}>Edit</button>
                    <button className="link danger" onClick={() => forget(e)}>Forget</button>
                  </span>
                </div>
              </details>
            ),
          )}
        </section>
      ))}
    </div>
  );
}

// ---------- context ----------

function ContextTab({ p }: { p: ProjectSnapshot }) {
  const { act } = useApp();
  const base = `/projects/${enc(p.slug)}`;
  const notes = useData<InboxNote[]>(`${base}/notes`);
  const [url, setUrl] = useState("");
  const [repo, setRepo] = useState("");
  const [note, setNote] = useState("");
  const send = async (path: string, body: object, clear: () => void) => {
    if (await act(() => api("POST", `${base}/${path}`, body))) clear();
  };
  const addNote = () => note.trim() && send("notes", { text: note }, () => setNote(""));
  return (
    <>
      <section className="group">
        <h3 className="label">Sources <span className="count">{p.sources.length}</span></h3>
        {!p.sources.length && <Empty>No sources. Add the docs, threads and links a sync should re-read.</Empty>}
        {p.sources.map((s) => (
          <div key={s.id} className="row">
            <span className="tag">{s.kind}</span>
            <a className="row-title" href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a>
            <span className="row-meta">
              <span>synced {ago(s.lastSyncedAt)}</span>
              <button className="link danger" onClick={() => confirm("Remove this source?") && act(() => api("DELETE", `${base}/sources/${enc(s.id)}`))}>Remove</button>
            </span>
          </div>
        ))}
        <input className="add-line" value={url} placeholder="Add a source: paste a link, then Enter" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url.trim() && send("sources", { url }, () => setUrl(""))} />
      </section>

      <section className="group">
        <h3 className="label">Codebases <span className="count">{p.repos.length}</span></h3>
        {!p.repos.length && <Empty>No codebases. Register a local checkout to send coding agents to it.</Empty>}
        {p.repos.map((r) => (
          <div key={r.name} className="row">
            <span className="row-title">{r.name}</span>
            <span className="row-meta">
              <span className="id">{r.path}</span>
              <button className="link danger" onClick={() => confirm("Remove this codebase? The checkout itself is untouched.") && act(() => api("DELETE", `${base}/repos/${enc(r.name)}`))}>Remove</button>
            </span>
          </div>
        ))}
        <input className="add-line" value={repo} placeholder="Add a codebase: absolute path to a local checkout, then Enter" onChange={(e) => setRepo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && repo.trim() && send("repos", { path: repo }, () => setRepo(""))} />
      </section>

      <section className="group">
        <h3 className="label">Quick notes awaiting sync <span className="count">{notes.data?.length ?? p.pendingNotes}</span></h3>
        {notes.data?.map((n) => (
          <div key={n.file} className="note">
            <pre>{n.text.trim()}</pre>
            <span className="row-meta">
              <span>{stamp(n.modifiedAt)}</span>
              <button className="link danger" onClick={() => confirm("Delete this note?") && act(() => api("DELETE", `${base}/notes/${enc(n.file)}`))}>Delete</button>
            </span>
          </div>
        ))}
        <div className="compose">
          <textarea rows={2} value={note} placeholder="Jot a note. The next sync absorbs it into tasks and memory." onChange={(e) => setNote(e.target.value)} onKeyDown={onSubmitKey(addNote)} />
          <button disabled={!note.trim()} onClick={addNote}>Add note</button>
        </div>
      </section>

      <section className="group">
        <h3 className="label">Project</h3>
        <div className="btn-row">
          <button onClick={() => {
            const name = prompt("Project name", p.name);
            if (name?.trim()) act(() => api("PATCH", base, { name }));
          }}>Rename</button>
          <button className="danger" onClick={async () => {
            if (!confirm(`Delete “${p.name}”? The whole project folder moves to the trash.`)) return;
            if (await act(() => api("DELETE", base))) go("#/");
          }}>Delete project</button>
        </div>
      </section>
    </>
  );
}
