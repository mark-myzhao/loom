import { useEffect, useRef, useState } from "react";
import type { Artifact, ArtifactDetail, MemoryEntry, ProjectSnapshot, RunMeta, Source, Task } from "../../server/types";
import { PROJECT_STATUSES } from "../../server/types";
import { ago, api, docHref, enc, go, onSubmitKey, taskHref, useApp, useData, useRoute } from "../lib";
import { Select } from "../controls";
import { editable, Empty, KindBadge, Markdown, RunList, TaskGroups } from "../ui";
import { Graph } from "./Graph";

const TABS = ["tasks", "graph", "artifacts", "memory", "context", "activity"] as const;
type Tab = (typeof TABS)[number];

export function ProjectPage({ project: p, tab }: { project: ProjectSnapshot; tab: string }) {
  const { snap, act, openRun } = useApp();
  const base = `/projects/${enc(p.slug)}`;
  const current: Tab = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : "tasks";
  const runs = snap.runs.filter((r) => r.project === p.slug);
  const [question, setQuestion] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

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
            <Select className={`inline-select st-${p.status}`} value={p.status} onChange={(status) => act(() => api("PATCH", base, { status }))} aria-label="Project status" options={PROJECT_STATUSES.map((s) => ({ value: s }))} />
          </p>
          <h1>{p.name}</h1>
        </div>
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
            {p.summary || "No summary yet. Click to write one."}
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
      {current === "memory" && <MemoryTab slug={p.slug} sources={p.sources} />}
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
        <Empty>No tasks yet. Type one above, or drop notes on Today and Claude will pull out your action items.</Empty>
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
            {a.over && <span className="memory-over" title={`Over length: ${a.over}.`}>Over length</span>}
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
        <Select value={f.type} onChange={(value) => set("type")({ target: { value } })} aria-label="Type" options={MEMORY_TYPES.map((t) => ({ value: t }))} />
      </div>
      <input value={f.description} onChange={set("description")} placeholder="The fact, in one sentence" />
      <textarea rows={4} value={f.body} onChange={set("body")} onKeyDown={onSubmitKey(save)} placeholder="Optional, a few lines: why it matters, how to apply it, then Source: where, date." />
      <div className="btn-row end">
        <button onClick={onDone}>Cancel</button>
        <button className="primary" disabled={!f.description.trim()} onClick={save}>{entry ? "Save" : "Remember"}</button>
      </div>
    </div>
  );
}

function MemoryTab({ slug, sources }: { slug: string; sources: Source[] }) {
  const { act } = useApp();
  const { data } = useData<MemoryEntry[]>(`/projects/${enc(slug)}/memory`);
  const [editing, setEditing] = useState<string | null>(null);
  // A [[entry]] link lands here as ?entry=<name>: open that entry and bring it into view.
  const target = useRoute().query.get("entry");
  useEffect(() => {
    const el = target && data ? document.getElementById(`memory-${target}`) : null;
    if (!(el instanceof HTMLDetailsElement)) return;
    el.open = true;
    el.scrollIntoView({ block: "center" });
  }, [target, !!data]);
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
              <details key={e.file} id={`memory-${e.name}`} className={`memory-entry${e.name === target ? " target" : ""}`}>
                <summary title="Show the detail">
                  <h4>{e.description || e.name}</h4>
                  {e.over && <span className="memory-over" title={`Over length: ${e.over}.`}>too long</span>}
                  <span className="id">{e.name}</span>
                </summary>
                <div className="memory-more">
                  {e.body && <Markdown text={e.body} slug={slug} />}
                  {(e.source || e.updated || e.over) && (
                    <p className="hint memory-origin">
                      {[
                        e.source && `from ${sources.find((s) => s.id === e.source)?.title || e.source}`,
                        e.updated && `checked ${e.updated}`,
                        e.over && `over length: ${e.over}`,
                      ].filter(Boolean).join(" · ")}
                    </p>
                  )}
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
  const [url, setUrl] = useState("");
  const [repo, setRepo] = useState("");
  const send = async (path: string, body: object, clear: () => void) => {
    if (await act(() => api("POST", `${base}/${path}`, body))) clear();
  };
  return (
    <>
      <section className="group">
        <h3 className="label">Sources <span className="count">{p.sources.length}</span></h3>
        {!p.sources.length && <Empty>No sources. Add the docs, threads and links this project draws on.</Empty>}
        {p.sources.map((s) => (
          <div key={s.id} className="row">
            <span className="tag">{s.kind}</span>
            <a className="row-title" href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a>
            <span className="row-meta">
              <button className="link danger" onClick={() => confirm("Remove this source?") && act(() => api("DELETE", `${base}/sources/${enc(s.id)}`))}>Remove</button>
            </span>
          </div>
        ))}
        <input className="add-line" value={url} placeholder="Add a source: paste a link, then Enter" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url.trim() && send("sources", { url }, () => setUrl(""))} />
      </section>

      <section className="group">
        <h3 className="label">Codebases <span className="count">{p.repos.length}</span></h3>
        {!p.repos.length && <Empty>No codebases. Register a local checkout to start Threads in it.</Empty>}
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
