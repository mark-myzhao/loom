import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Priority, RunMeta, TaskStatus, TaskSummary, ThreadState } from "../server/types";
import {
  agentRun, ago, api, buildTree, descendants, docHref, dueLabel, enc, GROUPS, isLive, money, sortTasks, STATUS_LABEL, taskHref, useApp,
  type Tree,
} from "./lib";

// ---------- identity ----------

/** Three nested, round-ended L strokes. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4v24h23" />
      <path d="M12 4v17h16" />
      <path d="M19 4v10h9" />
    </svg>
  );
}
/** The mark, completed by "oom" in monoline strokes. */
export function Wordmark() {
  return (
    <span className="wordmark" aria-label="Loom">
      <Mark size={26} />
      {/* Same 4..28 vertical extent as the L strokes, so every character is one height. */}
      <svg width="74.75" height="26" viewBox="0 0 92 32" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="14" cy="16" r="12" />
        <circle cx="44" cy="16" r="12" />
        <path d="M64 28V4m0 6.5a6.5 6.5 0 0 1 13 0V28m0-17.5a6.5 6.5 0 0 1 13 0V28" />
      </svg>
    </span>
  );
}

// ---------- status ----------

/** Status by shape as well as colour: empty, half, three-quarters, dashed, checked. */
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
          {status === "doing" && <path d="M8 4a4 4 0 0 1 0 8z" fill={c} />}
          {status === "review" && <path d="M8 8V4a4 4 0 1 1-4 4z" fill={c} />}
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

export function RunPill({ run }: { run: RunMeta }) {
  return <span className={`pill run-${run.status}${isLive(run) ? " live" : ""}`}>{run.status}</span>;
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

/** A Thread's mark, one strand over and under, coloured by its state. Broken splits it, so it reads without colour. */
export function ThreadMark({ state }: { state: ThreadState }) {
  return (
    <svg className={`mark thread-${state}`} viewBox="0 0 32 32" aria-hidden="true">
      <path d={state === "broken" ? "M3 20c4.5 0 4.5-8 9-8M21 20c4.5 0 4.5-8 9-8" : "M3 20c4.5 0 4.5-8 9-8s4.5 8 9 8 4.5-8 9-8"} />
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
      last = m.index + m[0].length;
    }
    if (!last) continue;
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

export function renderMarkdown(text: string, slug?: string): string {
  const html = DOMPurify.sanitize(marked.parse(text, { gfm: true, async: false }) as string);
  if (!slug) return html;
  const box = document.createElement("div");
  box.innerHTML = html;
  linkMentions(box, slug);
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
  const due = task.due ? dueLabel(task.due, task.status === "done") : undefined;
  const toggle = () =>
    act(() => api("PATCH", `/projects/${enc(slug)}/tasks/${task.id}`, { status: task.status === "done" ? "todo" : "done" }));
  return (
    <div className={`row task-row${task.status === "done" ? " is-done" : ""}`}>
      <button className="ring-btn" onClick={toggle} title={task.status === "done" ? "Reopen" : "Mark done"} aria-label={`${task.status === "done" ? "Reopen" : "Mark done"}: ${task.title}`}>
        <Ring status={task.status} />
      </button>
      <Prio p={task.priority} />
      <a className="row-title" href={taskHref(slug, task.id)}>{task.title}</a>
      <span className="row-meta">
        {run && (isLive(run) || task.status === "doing" || task.status === "review" || task.status === "blocked") && (
          <span className={`pill run-${run.status}${isLive(run) ? " live" : ""}`}>Thread {isLive(run) ? "working" : run.status}</span>
        )}
        {kids.length > 0 && <span title="Subtasks done">⤷ {kids.filter((k) => k.status === "done").length}/{kids.length}</span>}
        <Progress done={task.checked} total={task.total} title="Checklist" />
        {due && <span className={due.overdue ? "overdue" : ""}>{due.text}</span>}
        {task.parent && <a href={taskHref(slug, task.parent)} title="Parent task">↑ {task.parent}</a>}
        {showProject && <a href={`#/p/${enc(slug)}`} className="tag">{showProject}</a>}
        <span className="id">{task.id}</span>
      </span>
    </div>
  );
}

/** The five groups, Done collapsed at first. */
export function TaskGroups({ slug, tasks }: { slug: string; tasks: TaskSummary[] }) {
  const [showDone, setShowDone] = useState(false);
  const tree = useMemo(() => buildTree(tasks), [tasks]);
  return (
    <>
      {GROUPS.map(({ status, label }) => {
        const group = sortTasks(tasks.filter((t) => t.status === status));
        if (!group.length) return null;
        const collapsed = status === "done" && !showDone;
        return (
          <section key={status} className="group">
            <h3 className="label">
              {status === "done" ? (
                <button className="link" aria-expanded={!collapsed} onClick={() => setShowDone(!showDone)}>{collapsed ? "▸" : "▾"} {label}</button>
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
    <button className="row run-row" onClick={() => openRun(run.id)}>
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
  if (!runs.length) return <Empty>No runs yet. Drops, automations, questions and delegated tasks will appear here.</Empty>;
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
