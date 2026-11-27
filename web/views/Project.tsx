import { useEffect, useRef, useState } from "react";
import type { Artifact, ArtifactDetail, GraphEdge, MemoryEntry, ProjectSnapshot, Source, Task } from "../../server/types";
import { isClosed, PROJECT_STATUSES } from "../../server/types";
import { ago, api, docHref, enc, go, onSubmitKey, taskHref, useApp, useData, useRoute } from "../lib";
import { Select } from "../controls";
import { editable, Empty, KindBadge, Markdown, RunList, TaskGroups } from "../ui";
import { Graph } from "./Graph";

const TABS = ["tasks", "graph", "artifacts", "memory", "context", "activity"] as const;
type Tab = (typeof TABS)[number];

export function ProjectPage({ project: p, tab }: { project: ProjectSnapshot; tab: string }) {
  const { snap, act } = useApp();
  const base = `/projects/${enc(p.slug)}`;
  const current: Tab = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : "tasks";
  const runs = snap.runs.filter((r) => r.project === p.slug);
  const [editing, setEditing] = useState<string | null>(null);

  const saveSummary = async () => {
    if (editing !== null && editing !== p.summary) await act(() => api("PATCH", base, { summary: editing }));
    setEditing(null);
  };
  const counts: Partial<Record<Tab, number>> = {
    tasks: p.tasks.filter((t) => !isClosed(t.status)).length,
    artifacts: p.artifacts,
    memory: p.memory,
    context: p.sources.length + p.repos.length,
    activity: runs.length,
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="label">
            <a href={taskHref(p.slug, "T-000")} title="The project is its root task: its timeline, checklist and Threads">T-000</a> ·{" "}
            <Select className={`inline-select st-${p.status}`} value={p.status} onChange={(status) => act(() => api("PATCH", base, { status }))} aria-label="Project status" options={PROJECT_STATUSES.map((s) => ({ value: s }))} />
          </p>
          <h1>{p.name}</h1>
        </div>
      </header>

      {p.error && <p className="banner bad">This project’s metadata is unreadable: {p.error}. Fix <code>projects/{p.slug}/tasks/T-000.md</code> in an editor.</p>}

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
      {current === "artifacts" && <ArtifactsTab p={p} />}
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
  link: { text: "Link", className: " by-import" },
  repo: { text: "Codebase", className: " by-import" },
};

/** With `fold`, a document is indented under the one that links to it, which shows or hides those under it. The star pins it to the top of the Artifacts tab. */
export function ArtifactRows({ slug, items, inherited, fold }: { slug: string; items: Artifact[]; inherited?: string; fold?: { depth: Map<string, number>; kids: Map<string, number>; open: Set<string>; toggle: (key: string) => void } }) {
  const { act } = useApp();
  const pin = (e: React.MouseEvent, a: Artifact) => {
    e.preventDefault();
    act(() => api("PATCH", `/projects/${enc(slug)}/artifacts/${enc(a.name)}`, { pinned: !a.pinned }));
  };
  return (
    <>
      {items.map((a) => (
        <a key={a.name} className="row doc-row" style={{ paddingLeft: 2 + 30 * (fold?.depth.get(a.name) ?? 0) }} href={docHref(slug, a.name)}>
          <KindBadge kind={a.kind} />
          <span className="row-title">{a.title}</span>
          {fold?.kids.has(a.name) && (
            <button className="link fold" aria-expanded={fold.open.has(a.name)} onClick={(e) => (e.preventDefault(), fold.toggle(a.name))}>{fold.open.has(a.name) ? "▾" : "▸"} {fold.kids.get(a.name)} linked</button>
          )}
          <span className="id">{a.name}</span>
          <span className="row-meta">
            {a.over && <span className="memory-over" title={`Over length: ${a.over}.`}>Over length</span>}
            {inherited ? <span>from {inherited}</span> : a.task && <span>{a.task}</span>}
            {a.origin && <span className={`tag${ORIGIN[a.origin]?.className ?? ""}`}>{ORIGIN[a.origin]?.text ?? a.origin}</span>}
            <span>{ago(a.modifiedAt)}</span>
            <button className={`link pin${a.pinned ? " on" : ""}`} aria-pressed={!!a.pinned} title={a.pinned ? "Unpin" : "Pin to the top of Artifacts"} onClick={(e) => pin(e, a)}>{a.pinned ? "★" : "☆"}</button>
          </span>
        </a>
      ))}
    </>
  );
}

/** The section heading with its two ways to add one: write a blank document, or upload a file. A Thread on the task writes the rest. */
export function ArtifactsHead({ slug, taskId, count }: { slug: string; taskId?: string; count?: number }) {
  const { act, toast } = useApp();
  const file = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState<string | null>(null);
  const base = `/projects/${enc(slug)}/artifacts`;
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
          {title === null ? (
            <button className="link" onClick={() => setTitle("")}>New document</button>
          ) : (
            <input autoFocus value={title} placeholder="Document title, then Enter" onChange={(e) => setTitle(e.target.value)} onBlur={() => !title && setTitle(null)} onKeyDown={(e) => (e.key === "Enter" ? create() : e.key === "Escape" && setTitle(null))} />
          )}
          <button className="link" onClick={() => file.current?.click()}>Upload</button>
          <input ref={file} type="file" accept=".md,.html,.htm,text/markdown,text/html" hidden onChange={(e) => (upload(e.target.files?.[0]), (e.target.value = ""))} />
        </span>
      </div>
    </>
  );
}

/**
 * Orders one task's documents as an outline: a document sits under the one that links to it. Pages
 * often link back to their index, so the parent must link to more documents than the child does;
 * that also rules out a loop. Those under a document that is not open are left out.
 */
function outline(items: Artifact[], edges: GraphEdge[], open: Set<string>) {
  const names = new Set(items.map((a) => a.name));
  const links = new Map(items.map((a) => [a.name, new Set(edges.filter((e) => e.rel === "mentions" && e.from === a.name).map((e) => e.to.split("#")[0]!).filter((to) => names.has(to)))]));
  const out = (a: Artifact) => links.get(a.name)!;
  const parent = (a: Artifact) => items.filter((b) => out(b).has(a.name) && out(b).size > out(a).size).sort((x, y) => out(y).size - out(x).size)[0];
  const ordered: Artifact[] = [];
  const depth = new Map<string, number>();
  const kids = new Map<string, number>();
  const add = (a: Artifact, d: number) => {
    ordered.push(a);
    depth.set(a.name, d);
    const under = items.filter((c) => parent(c) === a);
    if (under.length) kids.set(a.name, under.length);
    if (open.has(a.name)) for (const c of under) add(c, d + 1);
  };
  for (const a of items) if (!parent(a)) add(a, 0);
  return { ordered, depth, kids };
}

/**
 * Pinned first, then a group per task, newest group first, each an outline by the documents' own
 * links. A group starts open and linked documents start folded; a filter shows every match.
 */
function ArtifactsTab({ p }: { p: ProjectSnapshot }) {
  const { data } = useData<Artifact[]>(`/projects/${enc(p.slug)}/artifacts`);
  const { data: graph } = useData<{ edges: GraphEdge[] }>(`/projects/${enc(p.slug)}/graph`);
  const [q, setQ] = useState("");
  const shown = (data ?? []).filter((a) => `${a.title} ${a.name} ${a.task ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const pinned = shown.filter((a) => a.pinned);
  // What the owner has flipped from its default: a group's id to fold it, a document's name to open it.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setFlipped(new Set(flipped.has(key) ? [...flipped].filter((k) => k !== key) : [...flipped, key]));
  return (
    <>
      <ArtifactsHead slug={p.slug} count={data?.length} />
      {data && !data.length && <Empty>No artifacts yet. Write one, upload a file, or start a Thread on a task to write one. Anything too long for a task belongs here.</Empty>}
      {!!data?.length && <input className="add-line" type="search" value={q} aria-label="Filter artifacts" placeholder="Filter by title, file or task" onChange={(e) => setQ(e.target.value)} />}
      {pinned.length > 0 && (
        <section className="group">
          <h3 className="label">Pinned<span className="count">{pinned.length}</span></h3>
          <ArtifactRows slug={p.slug} items={pinned} />
        </section>
      )}
      {[...new Set(shown.map((a) => a.task ?? ""))].map((id) => {
        const items = shown.filter((a) => (a.task ?? "") === id);
        const open = q.trim() ? new Set(items.map((a) => a.name)) : flipped;
        const folded = !q.trim() && flipped.has(id || "Project");
        const { ordered, ...shape } = outline(items, graph?.edges ?? [], open);
        return (
          <section key={id} className="group">
            <h3 className="label">
              <button className="link" aria-expanded={!folded} aria-label={`${folded ? "Show" : "Hide"} ${id || "Project"}`} onClick={() => toggle(id || "Project")}>{folded ? "▸" : "▾"}</button>&nbsp;
              {id ? <a href={taskHref(p.slug, id)}>{id} <span className="path">{p.tasks.find((t) => t.id === id)?.title}</span></a> : "Project"}
              <span className="count">{items.length}</span>
            </h3>
            {!folded && <ArtifactRows slug={p.slug} items={ordered} fold={{ ...shape, open, toggle }} />}
          </section>
        );
      })}
      {!!data?.length && !shown.length && <Empty>Nothing matches “{q}”.</Empty>}
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
