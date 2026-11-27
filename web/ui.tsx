import DOMPurify from "dompurify";
import { marked } from "marked";
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Select } from "./controls";
import { EFFORTS, isClosed, MODELS, type BoardRow, type Override, type Priority, type RunMeta, type TaskStatus, type TaskSummary } from "../server/types";
import {
  agentRun, ago, api, buildTree, descendants, docHref, dueLabel, enc, GROUPS, isLive, money, onSubmitKey, sortTasks, STATUS_LABEL, taskHref, useApp,
  type Tree,
} from "./lib";

// ---------- identity ----------

/** The wordmark as docs/logo.svg draws it: three nested L strokes and "oom" on one 32-unit grid, one height. */
export function Wordmark() {
  return (
    <svg className="wordmark" width="100.75" height="26" viewBox="0 0 124 32" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Loom">
      <path d="M5 4v24h23M12 4v17h16M19 4v10h9" />
      <g transform="translate(32)">
        <circle cx="14" cy="16" r="12" />
        <circle cx="44" cy="16" r="12" />
        <path d="M64 28V4m0 6.5a6.5 6.5 0 0 1 13 0V28m0-17.5a6.5 6.5 0 0 1 13 0V28" />
      </g>
    </svg>
  );
}

// ---------- status ----------

/** Status by shape as well as colour: empty, half, three-quarters, dashed, checked, crossed out. */
export function Ring({ status, size = 16 }: { status: TaskStatus; size?: number }) {
  const c = `var(--st-${status})`;
  return (
    <svg className="ring" width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={STATUS_LABEL[status]}>
      {status === "done" ? (
        <>
          <circle cx="8" cy="8" r="7" fill={c} />
          <path d="M4.6 8.3l2.3 2.3 4.5-4.9" fill="none" stroke="var(--paper)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray={status === "blocked" ? "2.6 2.3" : undefined} />
          {status === "in-progress" && <path d="M8 4a4 4 0 0 1 0 8z" fill={c} />}
          {status === "review" && <path d="M8 8V4a4 4 0 1 1-4 4z" fill={c} />}
          {status === "cancelled" && <path d="M5.5 5.5l5 5m0-5l-5 5" stroke={c} strokeWidth="1.5" strokeLinecap="round" />}
        </>
      )}
    </svg>
  );
}

export function StatusChip({ status }: { status: TaskStatus }) {
  return <span className={`chip st-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Prio({ p }: { p: Priority }) {
  return <span className={`prio prio-${p}`}>{p.toUpperCase()}</span>;
}

/** A Thread that ended on a question the owner has not answered reads "asks", not "done" (threads/states.md). */
const runState = (board: BoardRow[], run: RunMeta) => (board.some((b) => b.state === "asks" && b.runId === run.id) ? "asks" : run.status);

export function RunPill({ run }: { run: RunMeta }) {
  const state = runState(useApp().snap.board, run);
  return <span className={`pill run-${state}${isLive(run) ? " live" : ""}`}>{state}</span>;
}

/** Props for text that opens its editor on click, Enter or Space. Style it with `.editable`. */
export function editable(open: () => void, title: string) {
  return {
    className: "editable", role: "button", tabIndex: 0, title, onClick: open,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      open();
    },
  };
}

/** The Shuttle's mark: the weft carried over, under and over three warp threads (docs/design/brand/marks.md). */
export const SHUTTLE_PATH = "M5 4v7.5M5 20.5V28M12 4v24M19 4v7.5M19 20.5V28M2.5 16h6.5M15 16h14M24 11l5 5-5 5";
export function ShuttleMark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d={SHUTTLE_PATH} />
    </svg>
  );
}

/** A Thread's mark, one strand over and under, coloured by its state. Failed splits it, so it reads without colour. */
export function ThreadMark({ state }: { state: BoardRow["state"] }) {
  return (
    <svg className={`mark thread-${state}`} viewBox="0 0 32 32" aria-hidden="true">
      <path d={state === "failed" ? "M3 20c4.5 0 4.5-8 9-8M21 20c4.5 0 4.5-8 9-8" : "M3 20c4.5 0 4.5-8 9-8s4.5 8 9 8 4.5-8 9-8"} />
    </svg>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

// ---------- markdown ----------

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node instanceof HTMLAnchorElement && node.hasAttribute("href")) {
    if (!node.getAttribute("href")!.startsWith("#")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  }
});

const MENTION = /(?:[\w./-]*\/)?artifacts\/([A-Za-z0-9][\w.-]*\.(?:md|html?))|\[\[([^\]\n]+)\]\]/g;

/** Turns artifact paths and `[[links]]` in rendered text into links. */
function linkMentions(root: HTMLElement, slug: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const n = walker.currentNode as Text;
    if (!n.parentElement?.closest("a, pre, code")) nodes.push(n);
  }
  for (const node of nodes) {
    const text = node.data;
    MENTION.lastIndex = 0;
    let m: RegExpExecArray | null, last = 0;
    const frag = document.createDocumentFragment();
    while ((m = MENTION.exec(text))) {
      frag.append(text.slice(last, m.index));
      // Where a link goes, by the shape of its address; a file in a repository has no page here.
      const target = (m[2] ?? "").split("#")[0]!;
      const task = /^(?:([a-z0-9][a-z0-9-]*)\/)?(T-\d+)(?:\.\d+)?$/.exec(target);
      const href = m[1] ? docHref(slug, m[1])
        : task ? taskHref(task[1] ?? slug, task[2]!)
        : target.includes(":") ? undefined
        : /\.(md|html?)$/i.test(target) ? docHref(slug, target)
        : `#/p/${enc(slug)}/memory?entry=${enc(target)}`;
      const a = document.createElement(href ? "a" : "code");
      if (href) a.setAttribute("href", href);
      a.textContent = m[2] ?? m[0];
      frag.append(a);
      // A visual linked in a paragraph of its own is shown in place, in the sandbox its own page gets.
      const name = m[1] ?? target;
      if (/\.html?$/i.test(name) && text.trim() === m[0] && node.parentElement?.childNodes.length === 1) {
        const frame = document.createElement("iframe");
        frame.className = "doc-embed";
        frame.setAttribute("sandbox", "allow-scripts");
        frame.src = `/api/projects/${enc(slug)}/artifacts/${enc(name)}/raw`;
        frame.title = name;
        frag.append(frame);
      }
      last = m.index + m[0].length;
    }
    if (!last) continue;
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

/** Wraps a heading and what follows it, up to the next heading matching `stop`, in a block. */
function wrapSection(h: Element, stop: RegExp, className: string) {
  const block = document.createElement("section");
  block.className = className;
  h.before(block);
  for (let n: Element | null = h; n && (n === h || !stop.test(n.tagName)); ) {
    const next: Element | null = n.nextElementSibling;
    block.append(n);
    n = next;
  }
}

/** The document template's markers (defined for agents in server/conventions.md, "Layout markers"). */
function drawBlocks(root: HTMLElement) {
  root.querySelectorAll(":scope > h2").forEach((h) => {
    if (h.textContent!.trim() === "Summary") wrapSection(h, /^H[12]$/, "summary");
  });
  root.querySelectorAll(":scope > h4").forEach((h) => {
    if (/^\d+\.\s/.test(h.textContent!)) wrapSection(h, /^H[1-4]$/, "item-card");
  });
  root.querySelectorAll("blockquote").forEach((q) => {
    const p = q.firstElementChild;
    const m = p?.tagName === "P" ? /^\[!(note|decision|warning)\][ \t]*\n?/i.exec(p.innerHTML) : null;
    if (!m) return;
    p!.innerHTML = p!.innerHTML.slice(m[0].length);
    if (!p!.textContent!.trim()) p!.remove();
    q.className = `callout ${m[1]!.toLowerCase()}`;
  });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const n = walker.currentNode as Text;
    if (/\{(small|medium|large)\}/.test(n.data) && !n.parentElement?.closest("pre, code")) nodes.push(n);
  }
  for (const node of nodes) {
    const box = document.createElement("span");
    box.innerHTML = node.data.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)
      .replace(/\{(small|medium|large)\}/g, '<span class="effort $1">$1</span>');
    node.replaceWith(...box.childNodes);
  }
}

export function renderMarkdown(text: string, slug?: string): string {
  // `::: cards` … `:::` becomes a div the list inside renders into; the blank lines keep it markdown.
  const md = text.replace(/^::: ?cards[ \t]*\n([\s\S]*?)\n:::[ \t]*$/gm, '<div class="cards">\n\n$1\n\n</div>');
  const box = document.createElement("div");
  box.innerHTML = DOMPurify.sanitize(marked.parse(md, { gfm: true, async: false }) as string);
  drawBlocks(box);
  if (slug) linkMentions(box, slug);
  return box.innerHTML;
}

/** Sanitised markdown. With `onCheck`, task-list checkboxes are live and report their index. */
export function Markdown({ text, slug, className = "", onCheck }: {
  text: string; slug?: string; className?: string; onCheck?: (index: number, checked: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => {
    const out = renderMarkdown(text, slug);
    return onCheck ? out.replace(/(<input\b[^>]*?)\sdisabled(="")?/g, "$1") : out;
  }, [text, slug, !!onCheck]);
  return (
    <div
      ref={ref}
      className={`prose ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (!onCheck || !(el instanceof HTMLInputElement) || el.type !== "checkbox") return;
        const boxes = [...ref.current!.querySelectorAll('input[type="checkbox"]')];
        onCheck(boxes.indexOf(el), el.checked);
      }}
    />
  );
}

// ---------- rows ----------

export function Progress({ done, total, title }: { done: number; total: number; title?: string }) {
  if (!total) return null;
  return (
    <span className="progress" title={title}>
      <span className="track"><span style={{ width: `${(done / total) * 100}%` }} /></span>
      {done}/{total}
    </span>
  );
}

export function TaskRow({ slug, task, tree, showProject }: { slug: string; task: TaskSummary; tree: Tree; showProject?: string }) {
  const { snap, act } = useApp();
  const run = agentRun(snap.runs, slug, task.id);
  const kids = descendants(tree, task.id);
  const closed = isClosed(task.status);
  const due = task.due ? dueLabel(task.due, closed) : undefined;
  const toggle = () => act(() => api("PATCH", `/projects/${enc(slug)}/tasks/${task.id}`, { status: closed ? "todo" : "done" }));
  return (
    <div className={`row task-row${closed ? " is-done" : ""}`}>
      <button className="ring-btn" onClick={toggle} title={closed ? "Reopen" : "Mark done"} aria-label={`${closed ? "Reopen" : "Mark done"}: ${task.title}`}>
        <Ring status={task.status} />
      </button>
      <Prio p={task.priority} />
      <a className="row-title" href={taskHref(slug, task.id)}>{task.title}</a>
      <span className="row-meta">
        {run && (isLive(run) || task.status === "in-progress" || task.status === "review" || task.status === "blocked") && (
          <span className={`pill run-${runState(snap.board, run)}${isLive(run) ? " live" : ""}`}>Thread {isLive(run) ? "working" : runState(snap.board, run)}</span>
        )}
        {kids.length > 0 && <span title="Subtasks done or cancelled">⤷ {kids.filter((k) => isClosed(k.status)).length}/{kids.length}</span>}
        <Progress done={task.checked} total={task.total} title="Checklist" />
        {due && <span className={due.overdue ? "overdue" : ""}>{due.text}</span>}
        {task.parent && <a href={taskHref(slug, task.parent)} title="Parent task">↑ {task.parent}</a>}
        {task.after?.map((a) => <a key={a} href={taskHref(a.includes("/") ? a.split("/")[0]! : slug, a.split("/").pop()!)} title="Waits on this task until it is done">after {a}</a>)}
        {showProject && <a href={`#/p/${enc(slug)}`} className="tag">{showProject}</a>}
        <span className="id">{task.id}</span>
      </span>
    </div>
  );
}

/** The six groups, Done and Cancelled collapsed at first. */
export function TaskGroups({ slug, tasks }: { slug: string; tasks: TaskSummary[] }) {
  const [shown, setShown] = useState<Set<TaskStatus>>(new Set());
  const tree = useMemo(() => buildTree(tasks), [tasks]);
  return (
    <>
      {GROUPS.map(({ status, label }) => {
        const group = sortTasks(tasks.filter((t) => t.status === status));
        if (!group.length) return null;
        const collapsed = isClosed(status) && !shown.has(status);
        return (
          <section key={status} className="group">
            <h3 className="label">
              {isClosed(status) ? (
                <button className="link" aria-expanded={!collapsed} onClick={() => setShown(new Set(collapsed ? [...shown, status] : [...shown].filter((s) => s !== status)))}>{collapsed ? "▸" : "▾"} {label}</button>
              ) : label}
              <span className="count">{group.length}</span>
            </h3>
            {!collapsed && group.map((t) => <TaskRow key={t.id} slug={slug} task={t} tree={tree} />)}
          </section>
        );
      })}
    </>
  );
}

export function RunRow({ run, projectName }: { run: RunMeta; projectName?: string }) {
  const { openRun } = useApp();
  return (
    <button className="row run-row" data-track="run" onClick={() => openRun(run.id)}>
      <RunPill run={run} />
      <span className="tag">{run.kind}</span>
      <span className="row-title">{run.title}</span>
      <span className="row-meta">
        {projectName && <span className="tag">{projectName}</span>}
        {run.costUsd > 0 && <span>{money(run.costUsd)}</span>}
        <span>{ago(run.endedAt ?? run.startedAt ?? run.createdAt)}</span>
      </span>
    </button>
  );
}

export function RunList({ runs, withProject }: { runs: RunMeta[]; withProject?: boolean }) {
  const { snap } = useApp();
  if (!runs.length) return <Empty>No runs yet. Drops, automations and Threads will appear here.</Empty>;
  const names = new Map(snap.projects.map((p) => [p.slug, p.name]));
  return (
    <>
      <p className="label">{runs.length} run{runs.length === 1 ? "" : "s"} · {money(runs.reduce((s, r) => s + r.costUsd, 0))}</p>
      {runs.map((r) => <RunRow key={r.id} run={r} projectName={withProject && r.project ? names.get(r.project) ?? r.project : undefined} />)}
    </>
  );
}

export function KindBadge({ kind }: { kind: "md" | "html" }) {
  return <span className={`kind kind-${kind}`}>{kind === "md" ? "MD" : "HTML"}</span>;
}

/**
 * The model and effort for a session, showing what the CLI will use until changed. A pick stays empty
 * until made, so what is shown is the session's model, else the CLI's settings, else its documented
 * defaults (Opus 5.5; medium effort on these models). An alias such as "fable" shows as the model it
 * names. https://code.claude.com/docs/en/model-config
 */
export function ModelPick({ model: defaultModel, pick, onPick, className = "" }: {
  model: string; pick: Override; onPick: (pick: Override) => void; className?: string;
}) {
  const { snap } = useApp();
  const cli = snap.cliModel;
  const model = pick.model || defaultModel || MODELS.find((m) => m.value === cli || m.label.toLowerCase().startsWith(`${cli} `))?.value || cli || "claude-opus-5-5";
  const effort = pick.effort || snap.cliEffort[model] || snap.cliEffort[""] || "medium";
  // A model the list does not name (an older id, say) still shows as the current choice.
  const models = MODELS.some((m) => m.value === model) ? MODELS : [{ value: model }, ...MODELS];
  return (
    <>
      <Select className={className} value={model} onChange={(m) => onPick({ ...pick, model: m })} aria-label="Model" options={models} />
      <Select className={`${className} effort`} value={effort} onChange={(e) => onPick({ ...pick, effort: e })} aria-label="Effort"
        options={EFFORTS.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))} />
    </>
  );
}

/** A chat box: the text grows with what is typed, Send sits inside it, and the message's model and effort sit below. */
export function Composer({ label, placeholder, busy, model, onSend }: {
  label: string; placeholder: string; busy?: boolean; model: string;
  onSend: (text: string, override: Override) => Promise<unknown>;
}) {
  const [text, setText] = useState("");
  const [pick, setPick] = useState<Override>({});
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    box.current!.style.height = "auto";
    box.current!.style.height = `${box.current!.scrollHeight}px`;
  }, [text]);
  const send = async () => {
    if (text.trim() && !busy && (await onSend(text, pick))) setText("");
  };
  return (
    <div className="composer">
      <div className="composer-box">
        <textarea ref={box} rows={2} value={text} aria-label={label} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={onSubmitKey(send)} />
        <button className="primary" disabled={!text.trim() || busy} onClick={send}>Send</button>
      </div>
      <div className="composer-meta">
        <ModelPick className="inline-select" model={model} pick={pick} onPick={setPick} />
      </div>
    </div>
  );
}
