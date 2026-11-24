import { useEffect, useMemo, useRef, useState } from "react";
import { CACHE_COLD_MS, type BoardRow, type RunMeta, type ThreadState } from "../../server/types";
import { compact } from "../../server/usage";
import { api, buildTree, enc, GROUPS, isLive, onSubmitKey, sortTasks, taskHref, useApp } from "../lib";
import { Empty, RunList, TaskRow } from "../ui";
import { Transcript, useRunLines } from "./RunDrawer";

/** The Shuttle: Loom's resident agent and the owner's one conversation with it. */
function Shuttle() {
  const { snap, act, openRun } = useApp();
  const [text, setText] = useState("");
  const [fresh, setFresh] = useState(false);
  const run = fresh ? undefined : snap.shuttle;
  const live = !!run && isLive(run);
  // The next message resumes a warm session and starts a fresh one when the cache has gone cold.
  const warm = live || (!!run?.endedAt && Date.now() - Date.parse(run.endedAt) < CACHE_COLD_MS);
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
            <span className="id" title="The session's largest context, and whether its prompt cache is still warm">
              {compact(run.peakContext ?? 0)} context · {warm ? "warm" : "cold"}
            </span>
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

const BOARD_GROUPS: { label: string; states: ThreadState[] }[] = [
  { label: "Needs you", states: ["asks", "broken", "blocked", "review"] },
  { label: "Running", states: ["running"] },
  { label: "Waiting to start", states: ["proposed", "queued"] },
];

/** What the owner can do in each state. An action named in WITH_TEXT first asks for its text. */
const ACTIONS: Record<ThreadState, string[]> = {
  asks: ["Answer"], running: ["Steer", "Stop"], queued: ["Cancel"], broken: ["Continue", "Drop"],
  blocked: ["Note"], review: ["Accept", "Send back"], proposed: ["Start", "Drop"],
};
const WITH_TEXT = ["Answer", "Steer", "Note", "Send back", "Start"];

/** One Thread, or a task waiting on the owner, with its state and what can be done about it. */
function ThreadRow({ row }: { row: BoardRow }) {
  const { snap, act, openRun } = useApp();
  const [pending, setPending] = useState<string | null>(null);
  const [text, setText] = useState("");
  const task = `/projects/${enc(row.project)}/tasks/${row.taskId}`;
  const p = snap.projects.find((x) => x.slug === row.project);
  const repo = p?.repos.find((r) => r.name === p.tasks.find((t) => t.id === row.taskId)?.repo) ?? p?.repos[0];
  const note = (body: string) => api("POST", `${task}/note`, { text: body, ...(row.address ? { thread: row.address } : {}) });
  const run = async (action: string, body: string) => {
    if (action === "Start") return api("POST", `${task}/delegate`, { repoPath: repo!.path, instructions: body });
    if (action === "Stop" || action === "Cancel") return api("POST", `/runs/${row.runId}/stop`);
    if (action === "Continue") return note("Continue from where you stopped; check the directory and git history first.");
    if (action === "Accept") return api("PATCH", task, { status: "done" });
    if (action === "Drop") return confirm(`Drop ${row.taskId}? The task moves to the trash.`) && api("DELETE", task);
    if (action === "Send back") await api("PATCH", task, { status: "doing" });
    return note(body);
  };
  const go = async (action: string, body = "") => {
    if (await act(() => run(action, body))) {
      setPending(null);
      setText("");
    }
  };
  return (
    <div className="thread-row">
      <div className="row">
        <span className={`pill state-${row.state}`}>{row.state}</span>
        <a className="row-title" href={taskHref(row.project, row.taskId)}>{row.taskId} {row.title}</a>
        <span className="row-meta">
          {row.runId && <button className="link" onClick={() => openRun(row.runId!)}>{row.address}</button>}
          {ACTIONS[row.state].map((a) => (
            <button key={a} className="link" disabled={a === "Start" && !repo} title={a === "Start" && !repo ? "Register a codebase on the project first" : undefined}
              onClick={() => (WITH_TEXT.includes(a) ? setPending(a) : go(a))}>{a}</button>
          ))}
        </span>
      </div>
      {row.detail && <p className="thread-detail">{row.detail}</p>}
      {pending && (
        <div className="compose">
          <textarea autoFocus rows={2} value={text} aria-label={pending} placeholder={pending === "Start" ? "The Thread's purpose, in one line (optional)" : "Your note to the Thread…"}
            onChange={(e) => setText(e.target.value)} onKeyDown={onSubmitKey(() => go(pending, text))} />
          <span className="btn-row">
            <button onClick={() => setPending(null)}>Cancel</button>
            <button className="primary" disabled={pending !== "Start" && !text.trim()} onClick={() => go(pending, text)}>{pending}</button>
          </span>
        </div>
      )}
    </div>
  );
}

export function Today() {
  const { snap } = useApp();
  const active = snap.projects.filter((p) => p.status === "active");
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

      {BOARD_GROUPS.map(({ label, states }) => {
        // Grouped by task, so a task's Threads sit together.
        const rows = snap.board.filter((r) => states.includes(r.state)).sort((a, b) => `${a.project}/${a.taskId}`.localeCompare(`${b.project}/${b.taskId}`));
        return rows.length > 0 && (
          <section key={label} className="group">
            <h3 className="label">{label} <span className="count">{rows.length}</span></h3>
            {rows.map((r) => <ThreadRow key={`${r.project}/${r.taskId}/${r.address ?? ""}`} row={r} />)}
          </section>
        );
      })}

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
