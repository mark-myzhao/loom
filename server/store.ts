// The filesystem is the database. This module is the only reader/writer of records.
// A format change here must be mirrored in conventions.md and prompts.ts.

import {
  appendFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, readSync, readdirSync,
  renameSync, statSync, utimesSync, writeFileSync, writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  isClosed, memoryOver, PRIORITIES, PROJECT_STATUSES, SOURCE_KINDS, TASK_STATUSES,
  type AppState, type Artifact, type ArtifactDetail, type Automation, type Config, type MemoryEntry,
  type GraphEdge, type GraphNode, type Priority, type Project, type ProjectStatus, type Repo, type RunMeta, type Section, type Source,
  type SourceKind, type Task, type TaskStatus, type TimelineEvent,
} from "./types";

export const APP_ROOT = resolve(import.meta.dir, "..");
export const DATA = resolve(process.env.DASH_DATA_DIR || join(APP_ROOT, "data"));

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const bad = (msg: string, status = 400): never => {
  throw new HttpError(status, msg);
};

// ---------- time and ids ----------

export const nowIso = () => new Date().toISOString();
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const stamp = () => nowIso().replace(/[:.]/g, "-");
export function randomId(n: number): string {
  let s = "";
  while (s.length < n) s += Math.random().toString(36).slice(2);
  return s.slice(0, n);
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const TASK_ID_RE = /^T-\d+$/;
export const isSlug = (s: unknown): s is string => typeof s === "string" && s.length <= 80 && SLUG_RE.test(s);
export const isTaskId = (s: unknown): s is string => typeof s === "string" && TASK_ID_RE.test(s);
/** A bare filename that is safe to join onto a directory. */
export const isSafeFile = (s: unknown): s is string =>
  typeof s === "string" && s.length > 0 && s.length <= 200 && !/[\/\\\0]/.test(s) && !s.startsWith(".");

export function checkSlug(s: unknown): string {
  return isSlug(s) ? s : bad("invalid project slug");
}
export function checkTaskId(s: unknown): string {
  return isTaskId(s) ? s : bad("invalid task id");
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return base || "project";
}

// ---------- paths ----------

export const projectsDir = () => join(DATA, "projects");
export const projectDir = (slug: string) => join(projectsDir(), checkSlug(slug));
export const taskFile = (slug: string, id: string) => join(projectDir(slug), "tasks", `${checkTaskId(id)}.md`);
export const taskLogFile = (slug: string, id: string) => join(projectDir(slug), "tasks", `${checkTaskId(id)}.log.md`);
export const runsDir = () => join(DATA, "runs");

// ---------- low-level io ----------

/** Whole-file write through a temporary sibling and a rename. The watcher ignores `.tmp-` names. */
export function writeAtomic(path: string, content: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${randomId(6)}`);
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}
export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}
function readJson<T>(path: string): T | undefined {
  const t = readText(path);
  if (t === undefined) return undefined;
  try {
    return JSON.parse(t) as T;
  } catch {
    return undefined;
  }
}
const writeJson = (path: string, value: unknown) => writeAtomic(path, JSON.stringify(value, null, 2) + "\n");
function listDir(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}
function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
function readHead(path: string, chars: number): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(chars * 4);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString("utf8").slice(0, chars);
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Deletes are moves: `.trash/<slug>.<time>.<name>`. */
export function trash(path: string, slug: string) {
  if (!existsSync(path)) return;
  const dir = join(DATA, ".trash");
  mkdirSync(dir, { recursive: true });
  const name = basename(path);
  renameSync(path, join(dir, name === slug ? `${slug}.${stamp()}` : `${slug}.${stamp()}.${name}`));
}

// ---------- frontmatter ----------

export function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const src = text.replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  if (lines[0]?.trim() !== "---") return { data: {}, body: src };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return { data: {}, body: src };
  const data: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!.trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
      try {
        v = String(JSON.parse(v));
      } catch {
        v = v.slice(1, -1);
      }
    } else if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
      v = v.slice(1, -1).replace(/''/g, "'");
    }
    data[m[1]!] = v;
  }
  return { data, body: lines.slice(end + 1).join("\n").replace(/^\n+/, "") };
}

function fmValue(v: string): string {
  const s = v.replace(/\s*[\r\n]+\s*/g, " ");
  const ambiguous =
    s !== s.trim() || /^["'#&*!|>%@`\[\]{},?-]/.test(s) || /:\s|\s#/.test(s) || s.endsWith(":") ||
    /^(true|false|null|yes|no|~)$/i.test(s) || /^[\d.+-]+$/.test(s) && !/^\d{4}-\d{2}-\d{2}$/.test(s);
  return ambiguous ? JSON.stringify(s) : s;
}

export function formatFrontmatter(data: Record<string, string | undefined>, body: string): string {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => `${k}: ${fmValue(String(v))}`);
  const b = body.trim();
  return `---\n${lines.join("\n")}\n---\n${b ? `\n${b}\n` : ""}`;
}

// ---------- storage, config, state ----------

export const DEFAULT_FETCH_INSTRUCTIONS = `How to fetch sources:
- Public links: WebFetch. To find current sources: WebSearch.
- Private sources (Slack, Google Docs, GitHub): an MCP tool for that service, if this session has one. It may be deferred: look for it with ToolSearch before concluding it is missing.
- If a source cannot be fetched (no access, tool missing), do not guess its content. Say so in your final summary.`;

export const DEFAULT_CONFIG: Config = {
  ownerName: "",
  claudeBin: "claude",
  maxConcurrentRuns: 3,
  shuttleModel: "claude-fable-5-2",
  reader: {
    model: "",
    permissionMode: "acceptEdits",
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "ToolSearch"],
    // Leaving Bash off the allow-list is not enough: acceptEdits auto-approves read-only shell commands.
    disallowedTools: ["Bash"],
    fetchInstructions: DEFAULT_FETCH_INSTRUCTIONS,
  },
  agent: {
    model: "claude-opus-5-5",
    permissionMode: "auto",
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
    useWorktree: true,
  },
  telemetry: true,
};

const configPath = () => join(DATA, "config.json");
const statePath = () => join(DATA, "state.json");

/** Stored values over defaults, one level deep for reader and agent. Read on every action. */
export function loadConfig(): Config {
  // "sync" is the former name of "reader", so settings saved under it still apply; the schedule and connectors are gone.
  const { sync, schedule: _s, connectors: _c, connectorGateway: _g, ...s } = (readJson(configPath()) ?? {}) as Partial<Config> & { sync?: Partial<Config["reader"]>; [gone: string]: unknown };
  const d = DEFAULT_CONFIG;
  return {
    ...d,
    ...s,
    reader: { ...d.reader, ...(sync ?? {}), ...(s.reader ?? {}) },
    agent: { ...d.agent, ...(s.agent ?? {}) },
  };
}

const strList = (v: unknown, what: string): string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string")
    ? (v as string[]).map((x) => x.trim()).filter(Boolean)
    : bad(`${what} must be a list of strings`);

export function saveConfig(patch: Partial<Config>): Config {
  const cur = loadConfig();
  const next: Config = {
    ...cur,
    ...patch,
    reader: { ...cur.reader, ...(patch.reader ?? {}) },
    agent: { ...cur.agent, ...(patch.agent ?? {}) },
  };
  if (typeof next.ownerName !== "string" || typeof next.shuttleModel !== "string" || typeof next.claudeBin !== "string" || !next.claudeBin.trim())
    bad("ownerName, shuttleModel and claudeBin must be strings");
  next.maxConcurrentRuns = Math.round(Number(next.maxConcurrentRuns));
  if (!(next.maxConcurrentRuns >= 1 && next.maxConcurrentRuns <= 8)) bad("maxConcurrentRuns must be 1 to 8");
  next.reader.allowedTools = strList(next.reader.allowedTools, "reader.allowedTools");
  next.reader.disallowedTools = strList(next.reader.disallowedTools, "reader.disallowedTools");
  next.agent.allowedTools = strList(next.agent.allowedTools, "agent.allowedTools");
  next.agent.useWorktree = !!next.agent.useWorktree;
  for (const k of ["model", "permissionMode"] as const) {
    if (typeof next.reader[k] !== "string" || typeof next.agent[k] !== "string") bad(`${k} must be a string`);
  }
  if (typeof next.reader.fetchInstructions !== "string") bad("reader.fetchInstructions must be a string");
  writeJson(configPath(), next);
  return next;
}

export const loadState = (): AppState => readJson<AppState>(statePath()) ?? {};
export function saveState(patch: Partial<AppState>): AppState {
  // The daily sync and the connectors are gone; their keys drop out at the next save.
  const { lastDailySync: _d, connectors: _c, ...cur } = loadState() as AppState & Record<string, unknown>;
  const next = { ...cur, ...patch };
  writeJson(statePath(), next);
  return next;
}

const GITIGNORE = `# Loom: run history, runtime state and trash stay out of snapshots
runs/
state.json
telemetry/
.trash/
.*.tmp-*
.DS_Store
server.log
`;

/** Creates the layout, refreshes CLAUDE.md and memory indexes, and writes missing settings. */
export function initStorage() {
  for (const d of ["projects", "inbox/processed", "runs"]) mkdirSync(join(DATA, d), { recursive: true });
  const conventions = readFileSync(join(import.meta.dir, "conventions.md"), "utf8");
  if (readText(join(DATA, "CLAUDE.md")) !== conventions) writeAtomic(join(DATA, "CLAUDE.md"), conventions);
  if (readText(join(DATA, ".gitignore")) !== GITIGNORE) writeAtomic(join(DATA, ".gitignore"), GITIGNORE);
  if (!existsSync(configPath())) writeJson(configPath(), DEFAULT_CONFIG);
  for (const slug of listProjectSlugs()) {
    migrateProject(slug);
    migrateDoing(slug);
    rebuildMemoryIndex(slug);
  }
}

// ---------- projects ----------

export function listProjectSlugs(): string[] {
  return listDir(projectsDir()).filter((s) => isSlug(s) && isDir(join(projectsDir(), s)));
}

export function sourceKind(url: string): SourceKind {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "note";
  }
  if (host === "docs.google.com" || host === "drive.google.com") return "gdoc";
  if (host.endsWith("slack.com")) return "slack";
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  return "url";
}

// A project is the root task of its directory, T-000; its links and repositories are artifact files
// whose bodies live at the URL or path in `source` (ADR 0018). `Project` is the view built from them.
const ROOT = "T-000";
const PROJECT_STATUS: Record<TaskStatus, ProjectStatus> = { "in-progress": "active", review: "active", blocked: "active", todo: "paused", done: "done", cancelled: "done" };
const ROOT_STATUS: Record<ProjectStatus, TaskStatus> = { active: "in-progress", paused: "todo", done: "done" };

export function readProject(slug: string): Project {
  const root = readTask(slug, ROOT);
  if (!root) return { slug, name: slug, status: "active", summary: "", repos: [], sources: [], error: "tasks/T-000.md is missing" };
  const refs = listArtifacts(slug).filter((a) => a.source && (a.origin === "link" || a.origin === "repo"));
  const stem = (name: string) => name.replace(/\.md$/, "");
  return {
    slug,
    name: root.title,
    status: PROJECT_STATUS[root.status],
    summary: extractSection(root.body, "Context"),
    repos: refs.filter((a) => a.origin === "repo").map((a) => ({ name: stem(a.name), path: a.source! })),
    sources: refs.filter((a) => a.origin === "link").map((a) => ({ id: stem(a.name), kind: sourceKind(a.source!), url: a.source!, title: a.title, addedAt: a.created ?? "" })),
    createdAt: root.created,
    updatedAt: root.updated,
  };
}

/** A link or repository artifact: a title and where the body lives. Never overwrites; returns the name used. */
function writeReference(slug: string, stem: string, origin: "link" | "repo", title: string, source: string): string {
  let name = `${stem}.md`;
  if (existsSync(join(artifactsDir(slug), name))) name = `${stem}-${origin}.md`;
  writeAtomic(join(artifactsDir(slug), name), formatFrontmatter({ title, origin, source, created: today() }, ""));
  return name;
}

const rootTask = (title: string, status: TaskStatus, created: string, updated: string, context: string) =>
  formatFrontmatter({ id: ROOT, title, status, priority: "p2", created, updated }, `## Context\n${context}\n\n## Things to do\n\n## Exit criteria\n`);

/**
 * One-time: a project.json becomes tasks/T-000.md and an artifact per source and repository; then
 * it goes to the trash. A source keeps its id as its filename, so memory entries citing it still resolve.
 */
function migrateProject(slug: string) {
  const file = join(projectDir(slug), "project.json");
  const raw = readJson<Record<string, any>>(file);
  if (!raw || existsSync(taskFile(slug, ROOT))) return;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const day = (iso: unknown) => str(iso).slice(0, 10) || today();
  for (const d of ["tasks", "memory", "artifacts"]) mkdirSync(join(projectDir(slug), d), { recursive: true });
  const status = ROOT_STATUS[raw.status as ProjectStatus] ?? "in-progress";
  writeAtomic(taskFile(slug, ROOT), rootTask(str(raw.name) || slug, status, day(raw.createdAt), day(raw.updatedAt), str(raw.summary)));
  appendEvent(slug, ROOT, { by: "me", type: "created", detail: "from project.json" });
  for (const s of Array.isArray(raw.sources) ? raw.sources : []) {
    if (typeof s?.url !== "string") continue;
    const id = /^[a-z0-9][a-z0-9-]*$/.test(str(s.id)) ? str(s.id) : randomId(6);
    writeReference(slug, id, "link", str(s.title) || s.url, s.url);
  }
  for (const r of Array.isArray(raw.repos) ? raw.repos : []) {
    if (typeof r?.path !== "string") continue;
    const name = str(r.name) || basename(r.path);
    writeReference(slug, fileSlug(name) || "repo", "repo", name, r.path);
  }
  trash(file, slug);
}

/** One-time: the stored status `doing` is renamed `in-progress` (ADR 0020). The timeline keeps its history. */
function migrateDoing(slug: string) {
  for (const id of listTaskIds(slug)) {
    const text = readText(taskFile(slug, id)) ?? "";
    if (parseFrontmatter(text).data.status === "doing") writeAtomic(taskFile(slug, id), text.replace(/^status:\s*["']?doing["']?\s*$/m, "status: in-progress"));
  }
}

export function createProject(name: string): Project {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) bad("a project needs a name");
  const base = slugify(clean);
  let slug = base;
  for (let n = 2; existsSync(join(projectsDir(), slug)); n++) slug = `${base}-${n}`;
  for (const d of ["tasks", "memory", "artifacts"]) mkdirSync(join(projectsDir(), slug, d), { recursive: true });
  writeAtomic(taskFile(slug, ROOT), rootTask(clean, "in-progress", today(), today(), ""));
  appendEvent(slug, ROOT, { by: "me", type: "created" });
  rebuildMemoryIndex(slug);
  return readProject(slug);
}

/** The project's name, status and summary are its root task's title, status and Context. */
export function patchProject(slug: string, patch: { name?: unknown; status?: unknown; summary?: unknown }): Project {
  const root = readTask(slug, ROOT) ?? bad("tasks/T-000.md is missing", 409);
  const input: TaskInput = {};
  if (patch.name !== undefined) input.title = patch.name;
  if (patch.status !== undefined) {
    if (!PROJECT_STATUSES.includes(patch.status as ProjectStatus)) bad("status must be active, paused or done");
    input.status = ROOT_STATUS[patch.status as ProjectStatus];
  }
  if (patch.summary !== undefined) {
    if (typeof patch.summary !== "string") bad("summary must be a string");
    const lines = root.body.split("\n");
    const at = lines.findIndex((l) => /^##\s+context\s*$/i.test(l));
    const end = lines.findIndex((l, i) => i > at && l.startsWith("## "));
    const context = (patch.summary as string).trim();
    input.body = at < 0 ? `## Context\n${context}\n\n${root.body}` : [...lines.slice(0, at + 1), context, "", ...(end < 0 ? [] : lines.slice(end))].join("\n");
  }
  patchTask(slug, ROOT, input, "me");
  return readProject(slug);
}

export function deleteProject(slug: string) {
  const dir = projectDir(slug);
  if (!isDir(dir)) bad("no such project", 404);
  trash(dir, slug);
}

/** A new link is named for its title, so `[[weekly-notes.md]]` reads well; memory entries cite that name. */
export function addSource(slug: string, url: unknown, title?: unknown): Project {
  if (typeof url !== "string" || !/^https?:\/\/\S+$/i.test(url.trim())) bad("a source needs an http(s) url");
  const u = (url as string).trim();
  const p = readProject(slug);
  if (p.sources.some((s) => s.url === u)) bad("that source is already registered", 409);
  const t = typeof title === "string" && title.trim() ? title.trim() : u;
  writeReference(slug, fileSlug(t.replace(/^https?:\/\//, "")) || randomId(6), "link", t, u);
  return readProject(slug);
}

/** Removes a link or repository artifact, checking it is one. */
function removeReference(slug: string, stem: string, origin: "link" | "repo") {
  const meta = artifactMeta(slug, `${stem}.md`);
  if (meta?.origin !== origin) bad(origin === "link" ? "no such source" : "no such codebase", 404);
  trash(join(artifactsDir(slug), `${stem}.md`), slug);
}

export function removeSource(slug: string, id: string): Project {
  removeReference(slug, id, "link");
  return readProject(slug);
}

/** An absolute path to an existing directory, or a 400. */
export function checkRepoPath(path: unknown): string {
  if (typeof path !== "string" || !isAbsolute(path.trim())) bad("the repository path must be absolute");
  const p = resolve((path as string).trim());
  if (!isDir(p)) bad("the repository path is not an existing directory");
  return p;
}

export function addRepo(slug: string, path: unknown, name?: unknown): Project {
  const p = checkRepoPath(path);
  const n = fileSlug((typeof name === "string" && name.trim()) || basename(p));
  if (!n) bad("a codebase needs a name");
  if (existsSync(join(artifactsDir(slug), `${n}.md`))) bad(`an artifact named "${n}.md" already exists`, 409);
  writeReference(slug, n, "repo", n, p);
  return readProject(slug);
}

export function removeRepo(slug: string, name: string): Project {
  removeReference(slug, name, "repo");
  return readProject(slug);
}

// ---------- tasks ----------

const TASK_KEYS = ["id", "parent", "title", "status", "priority", "due", "after", "source", "repo", "run", "created", "updated"];
export const TASK_TEMPLATE = "## Context\n\n## Things to do\n\n## Exit criteria\n";
const CHECK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/gm;

export function countChecklist(body: string): { checked: number; total: number } {
  let checked = 0, total = 0;
  for (const m of body.matchAll(CHECK_RE)) {
    total++;
    if (m[2] !== " ") checked++;
  }
  return { checked, total };
}

/** From the matching `## heading` to the next `## ` or the end, ignoring case. */
export function extractSection(body: string, heading: string): string {
  const out: string[] = [];
  let inside = false;
  for (const line of body.split("\n")) {
    const m = /^##\s+(.*?)\s*#*\s*$/.exec(line);
    if (m && !line.startsWith("###")) {
      if (inside) break;
      inside = m[1]!.toLowerCase() === heading.toLowerCase();
      continue;
    }
    if (inside) out.push(line);
  }
  return out.join("\n").trim();
}

function parseTask(id: string, text: string): Task & { extra: Record<string, string> } {
  const { data, body } = parseFrontmatter(text);
  const firstLine = body.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) if (!TASK_KEYS.includes(k)) extra[k] = v;
  return {
    id,
    title: data.title || firstLine || id,
    status: TASK_STATUSES.includes(data.status as TaskStatus) ? (data.status as TaskStatus) : "todo",
    priority: PRIORITIES.includes(data.priority as Priority) ? (data.priority as Priority) : "p2",
    created: data.created || undefined,
    updated: data.updated || undefined,
    due: data.due || undefined,
    parent: isTaskId(data.parent) ? data.parent : undefined,
    after: data.after ? data.after.split(",").map((a) => a.trim()).filter(Boolean) : undefined,
    source: data.source || undefined,
    repo: data.repo || undefined,
    run: data.run || undefined,
    body,
    excerpt: (extractSection(body, "Context") || "").replace(/\s+/g, " ").slice(0, 240),
    ...countChecklist(body),
    extra,
  };
}

function serializeTask(t: Task & { extra?: Record<string, string> }): string {
  const fm: Record<string, string | undefined> = {};
  for (const k of TASK_KEYS) fm[k] = (t as any)[k];
  fm.id = t.id;
  fm.after = t.after?.join(", ");
  return formatFrontmatter({ ...fm, ...(t.extra ?? {}) }, t.body);
}

const taskNum = (id: string) => Number(id.slice(2));
const formatTaskId = (n: number) => `T-${String(n).padStart(3, "0")}`;

export function listTaskIds(slug: string): string[] {
  return listDir(join(projectDir(slug), "tasks"))
    .filter((f) => /^T-\d+\.md$/.test(f))
    .map((f) => f.slice(0, -3))
    .sort((a, b) => taskNum(a) - taskNum(b));
}

function readTaskRaw(slug: string, id: string) {
  const text = readText(taskFile(slug, id));
  return text === undefined ? undefined : parseTask(id, text);
}

export function readTask(slug: string, id: string): Task | undefined {
  const t = readTaskRaw(slug, id);
  if (!t) return undefined;
  const { extra: _extra, ...task } = t;
  return task;
}

export function listTasks(slug: string): Task[] {
  const tasks = listTaskIds(slug).map((id) => readTask(slug, id)).filter((t): t is Task => !!t);
  const ids = new Set(tasks.map((t) => t.id));
  // A parent that does not exist is ignored on reads.
  for (const t of tasks) if (t.parent && (!ids.has(t.parent) || t.parent === t.id)) t.parent = undefined;
  return tasks;
}

/** Nearest first. Stops on a repeated id, so a hand-made cycle cannot loop. */
export function ancestorsOf(tasks: Task[], id: string): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: Task[] = [];
  const seen = new Set([id]);
  let cur = byId.get(id)?.parent;
  while (cur && !seen.has(cur)) {
    const t = byId.get(cur);
    if (!t) break;
    out.push(t);
    seen.add(cur);
    cur = t.parent;
  }
  return out;
}

function checkParent(slug: string, id: string | undefined, parent: unknown): string {
  if (!isTaskId(parent)) bad("parent must be a task id");
  const tasks = listTasks(slug);
  const p = parent as string;
  if (!tasks.some((t) => t.id === p)) bad(`parent ${p} does not exist in this project`);
  if (id) {
    if (p === id) bad("a task cannot be its own parent");
    if (ancestorsOf(tasks, p).some((t) => t.id === id)) bad("a task cannot move below its own descendant");
  }
  return p;
}

// ---------- timeline ----------

const cleanDetail = (s: string) => s.replace(/\s+/g, " ").replace(/--+>/g, "->").replace(/<!--/g, "<!-").trim();
const cleanBody = (s: string) => s.replace(/\r\n/g, "\n").replace(/<!--(\s*event\s*:)/gi, "&lt;!--$1").trim();

export function appendEvent(
  slug: string, id: string,
  ev: { by: string; type: string; detail?: string; body?: string; time?: string },
) {
  const head = [ev.time ?? nowIso(), ev.by, ev.type];
  const detail = cleanDetail(ev.detail ?? "");
  if (detail) head.push(detail);
  const body = ev.body ? cleanBody(ev.body) : "";
  const file = taskLogFile(slug, id);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `\n<!-- event: ${head.join(" | ")} -->\n${body ? body + "\n" : ""}`);
}

export function readTimeline(slug: string, id: string): TimelineEvent[] {
  const text = readText(taskLogFile(slug, id));
  if (!text) return [];
  const events: TimelineEvent[] = [];
  let cur: (TimelineEvent & { lines: string[] }) | undefined;
  const close = () => {
    if (!cur) return;
    const { lines, ...ev } = cur;
    events.push({ ...ev, body: lines.join("\n").trim() });
  };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^<!--\s*event:\s*(.*?)\s*-->\s*$/.exec(line);
    if (m) {
      close();
      const parts = m[1]!.split("|").map((s) => s.trim());
      cur = {
        time: parts[0] ?? "", by: parts[1] ?? "", type: parts[2] ?? "comment",
        detail: parts.slice(3).join(" | "), body: "", lines: [],
      };
    } else if (cur) cur.lines.push(line);
  }
  close();
  return events;
}

// ---------- derived status ----------

/** A task's Threads, numbered by the order their runs started on its timeline; `run` is missing when its record is gone. */
export function threadsOf(slug: string, id: string, log = readTimeline(slug, id)): { address: string; time: string; run?: RunMeta }[] {
  return log.filter((e) => e.type === "run" && e.detail.startsWith("started")).map((start, i) => ({
    address: `${id}.${i + 1}`,
    time: start.time,
    run: readJson<RunMeta>(join(runsDir(), `${/run (\S+)$/.exec(start.detail)?.[1]}.json`)),
  }));
}

export interface Block {
  on: "human" | "task";
  /** Shown for the task: `blocked`, or the Thread state that holds it. */
  state: "blocked" | "asks" | "failed" | "ended";
  detail: string;
}

/**
 * Why a task reads as blocked, or nothing (threads/states.md). Assigned, an unanswered question, or
 * Threads that ended without a report wait on a human; an open `after` task or subtask waits on that
 * task. Human comes first. Derived on every read, so it is never stored and cannot go stale.
 */
export function blockOf(slug: string, t: Task, tasks: Task[], log: TimelineEvent[], threads: ReturnType<typeof threadsOf>): Block | undefined {
  if (isClosed(t.status)) return undefined;
  const line = (s = "") => s.replace(/^#.*$/gm, "").trim().split("\n")[0]!.trim().slice(0, 200);
  if (t.status === "blocked") return { on: "human", state: "blocked", detail: line(log.findLast((e) => e.type === "comment")?.body) };
  // The owner's note to the task, or to the Thread that asked, written after it answers a question.
  const at = log.findLastIndex((e) => e.type === "question");
  const q = log[at];
  if (q && !log.slice(at).some((e) => e.type === "note" && e.by === "me" && (!e.detail || e.detail === q.by)))
    return { on: "human", state: "asks", detail: line(q.body) };
  // Reported work waits on the owner's review, not on other tasks.
  if (t.status === "review") return undefined;
  const last = threads.at(-1);
  if (t.status === "in-progress" && last && threads.every((th) => th.run?.status !== "queued" && th.run?.status !== "running")) {
    const s = last.run?.status;
    if (s === "failed" || s === "stopped" || s === "interrupted")
      return { on: "human", state: "failed", detail: `${s}${last.run!.error ? `: ${line(last.run!.error)}` : ""}` };
    // A report is a comment signed by a Thread (or by "agent", before Threads were numbered) after the latest one started.
    if (!log.some((e) => e.type === "comment" && /^(T-\d+\.\d+|agent)$/.test(e.by) && e.time > last.time))
      return { on: "human", state: "ended", detail: "ended without a report" };
  }
  for (const a of [...(t.after ?? []), ...tasks.filter((c) => c.parent === t.id).map((c) => c.id)]) {
    const [s, id] = a.includes("/") ? a.split("/") : [slug, a];
    // An address that resolves to nothing does not hold.
    const other = s === slug ? tasks.find((x) => x.id === id) : isSlug(s) && isTaskId(id) ? readTask(s, id) : undefined;
    if (other && !isClosed(other.status)) return { on: "task", state: "blocked", detail: `${a} (${other.status})` };
  }
  return undefined;
}

// ---------- task writes ----------

export interface TaskInput {
  title?: unknown; status?: unknown; priority?: unknown; due?: unknown; parent?: unknown;
  repo?: unknown; source?: unknown; body?: unknown; run?: unknown; after?: unknown;
  /** Written to the timeline; required when the status becomes `blocked`, to say who or what it waits on. */
  comment?: unknown;
}

function cleanTaskInput(slug: string, id: string | undefined, input: TaskInput): Partial<Task> {
  const out: Partial<Task> = {};
  const optStr = (v: unknown, what: string) =>
    v === null || v === "" ? "" : typeof v === "string" ? v.trim() : bad(`${what} must be a string`);
  if (input.title !== undefined) {
    if (typeof input.title !== "string" || !input.title.trim()) bad("title must be a non-empty string");
    out.title = (input.title as string).trim().replace(/\s+/g, " ");
  }
  if (input.status !== undefined) {
    if (!TASK_STATUSES.includes(input.status as TaskStatus)) bad(`status must be one of ${TASK_STATUSES.join(", ")}`);
    out.status = input.status as TaskStatus;
    if (out.status === "blocked" && !(typeof input.comment === "string" && input.comment.trim()))
      bad("a blocked task needs a comment saying who or what it waits on");
  }
  if (input.priority !== undefined) {
    if (!PRIORITIES.includes(input.priority as Priority)) bad("priority must be p0 to p3");
    out.priority = input.priority as Priority;
  }
  if (input.due !== undefined) {
    const d = optStr(input.due, "due");
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) bad("due must be YYYY-MM-DD");
    out.due = d;
  }
  if (input.parent !== undefined) {
    out.parent = input.parent === null || input.parent === "" ? "" : checkParent(slug, id, input.parent);
  }
  if (input.after !== undefined) {
    out.after = optStr(input.after, "after").split(",").map((a) => a.trim()).filter(Boolean);
    if (out.after.some((a) => !/^([a-z0-9][a-z0-9-]*\/)?T-\d+$/.test(a))) bad("after must be task addresses, as T-005 or other-project/T-004");
  }
  if (input.repo !== undefined) out.repo = optStr(input.repo, "repo");
  if (input.source !== undefined) out.source = optStr(input.source, "source");
  if (input.run !== undefined) out.run = optStr(input.run, "run");
  if (input.body !== undefined) {
    if (typeof input.body !== "string") bad("body must be a string");
    out.body = input.body as string;
  }
  return out;
}

export function createTask(slug: string, input: TaskInput, by = "me"): Task {
  if (!isDir(projectDir(slug))) bad("no such project", 404);
  const clean = cleanTaskInput(slug, undefined, input);
  if (!clean.title) bad("a task needs a title");
  const parent = clean.parent ? readTask(slug, clean.parent) : undefined;
  const dir = join(projectDir(slug), "tasks");
  mkdirSync(dir, { recursive: true });
  const day = today();
  let n = Math.max(0, ...listTaskIds(slug).map(taskNum)) + 1;
  for (let attempt = 0; ; attempt++, n++) {
    const id = formatTaskId(n);
    const task: Task = {
      id,
      title: clean.title!,
      status: clean.status ?? "todo",
      // A new child inherits priority and repo unless overridden.
      priority: clean.priority ?? parent?.priority ?? "p2",
      due: clean.due || undefined,
      parent: clean.parent || undefined,
      after: clean.after,
      source: clean.source || undefined,
      repo: clean.repo || parent?.repo || undefined,
      created: day,
      updated: day,
      body: clean.body?.trim() ? clean.body : TASK_TEMPLATE,
      excerpt: "",
      checked: 0,
      total: 0,
    };
    let fd: number;
    try {
      // Exclusive creation: a concurrent allocation of the same id fails here and retries the next.
      fd = openSync(join(dir, `${id}.md`), "wx");
    } catch (e: any) {
      if (e?.code === "EEXIST" && attempt < 50) continue;
      throw e;
    }
    try {
      writeSync(fd, serializeTask(task));
    } finally {
      closeSync(fd);
    }
    appendEvent(slug, id, { by, type: "created" });
    if (typeof input.comment === "string" && input.comment.trim()) appendEvent(slug, id, { by, type: "comment", body: input.comment });
    return readTask(slug, id)!;
  }
}

export const TRACKED_FIELDS = ["priority", "due", "title", "repo", "parent"] as const;

/** Applies a patch and, when `by` is given, logs status and field changes on the timeline. A comment is always written. */
export function patchTask(slug: string, id: string, input: TaskInput, by?: string): Task {
  const cur = readTaskRaw(slug, id) ?? bad("no such task", 404);
  const clean = cleanTaskInput(slug, id, input);
  const next = { ...cur };
  for (const [k, v] of Object.entries(clean)) (next as any)[k] = v === "" && k !== "body" ? undefined : v;
  next.updated = today();
  writeAtomic(taskFile(slug, id), serializeTask(next));
  if (by) {
    if (next.status !== cur.status) appendEvent(slug, id, { by, type: "status", detail: `${cur.status} -> ${next.status}` });
    for (const f of TRACKED_FIELDS) {
      // `cur.parent` is the raw frontmatter value, so compare like with like.
      if ((next[f] ?? "") !== (cur[f] ?? ""))
        appendEvent(slug, id, { by, type: "field", detail: `${f}: ${cur[f] || "none"} -> ${next[f] || "none"}` });
    }
  }
  if (typeof input.comment === "string" && input.comment.trim()) appendEvent(slug, id, { by: by ?? "me", type: "comment", body: input.comment });
  return readTask(slug, id)!;
}

export function toggleChecklist(slug: string, id: string, index: number, checked: boolean): Task {
  const cur = readTaskRaw(slug, id) ?? bad("no such task", 404);
  let i = -1, found = false;
  const body = cur.body.replace(CHECK_RE, (all, a: string, _mark: string, c: string) => {
    if (++i !== index) return all;
    found = true;
    return `${a}${checked ? "x" : " "}${c}`;
  });
  if (!found) bad("no such checklist item", 404);
  writeAtomic(taskFile(slug, id), serializeTask({ ...cur, body, updated: today() }));
  return readTask(slug, id)!;
}

/** Trashes the task and its timeline; its immediate children move up to its former parent. */
export function deleteTask(slug: string, id: string) {
  if (id === ROOT) bad("T-000 is the project itself; delete the project instead");
  const tasks = listTasks(slug);
  const task = tasks.find((t) => t.id === id) ?? bad("no such task", 404);
  for (const child of tasks.filter((t) => t.parent === id)) patchTask(slug, child.id, { parent: task.parent ?? null }, "me");
  trash(taskFile(slug, id), slug);
  trash(taskLogFile(slug, id), slug);
}

// ---------- artifacts ----------

const artifactsDir = (slug: string) => join(projectDir(slug), "artifacts");
const artifactKind = (name: string): "md" | "html" | undefined =>
  /\.md$/i.test(name) ? "md" : /\.html?$/i.test(name) ? "html" : undefined;

export function artifactPath(slug: string, name: string): string {
  if (!isSafeFile(name) || !artifactKind(name)) bad("invalid artifact name");
  return join(artifactsDir(slug), name);
}

const decodeEntities = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function htmlMeta(head: string): Record<string, string> {
  const out: Record<string, string> = {};
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  if (title) out.title = decodeEntities(title[1]!.trim());
  for (const m of head.matchAll(/<meta\s+[^>]*>/gi)) {
    const name = /name\s*=\s*["']loom:([\w-]+)["']/i.exec(m[0]);
    const content = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(m[0]);
    if (name && content) out[name[1]!.toLowerCase()] = decodeEntities(content[1] ?? content[2] ?? "");
  }
  return out;
}

function artifactMeta(slug: string, name: string): Artifact | undefined {
  const kind = artifactKind(name);
  if (!kind || !isSafeFile(name)) return undefined;
  const path = join(artifactsDir(slug), name);
  let st;
  try {
    st = statSync(path);
  } catch {
    return undefined;
  }
  if (!st.isFile()) return undefined;
  // Metadata lives near the top: the listing reads only the first 4,000 characters.
  const head = readHead(path, 4000);
  let data: Record<string, string>;
  let heading: string | undefined;
  if (kind === "md") {
    const fm = parseFrontmatter(head);
    data = fm.data;
    heading = /^#\s+(.+)$/m.exec(fm.body)?.[1]?.trim();
  } else {
    data = htmlMeta(head);
    heading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(head)?.[1]?.replace(/<[^>]+>/g, "").trim();
  }
  return {
    name,
    kind,
    title: data.title || heading || name.replace(/\.(md|html?)$/i, ""),
    origin: data.origin || undefined,
    task: isTaskId(data.task) ? data.task : undefined,
    source: data.source || undefined,
    created: data.created || undefined,
    pinned: data.pinned === "true" || undefined,
    modifiedAt: st.mtime.toISOString(),
    size: st.size,
    // About 8,000 tokens at four characters a token: past that, a Thread cannot afford to read it.
    over: st.size > 32_000 ? `split it by subject (~${Math.round(st.size / 4000)}K tokens; the limit is about 8K)` : undefined,
  };
}

/** Newest modification first. */
export function listArtifacts(slug: string): Artifact[] {
  return listDir(artifactsDir(slug))
    .map((n) => artifactMeta(slug, n))
    .filter((a): a is Artifact => !!a)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export function readArtifact(slug: string, name: string): ArtifactDetail {
  const path = artifactPath(slug, name);
  const meta = artifactMeta(slug, name) ?? bad("no such artifact", 404);
  return { ...meta, content: readFileSync(path, "utf8") };
}

export function writeArtifact(slug: string, name: string, content: unknown): ArtifactDetail {
  const path = artifactPath(slug, name);
  if (typeof content !== "string") bad("content must be a string");
  if (!existsSync(path)) bad("no such artifact", 404);
  writeAtomic(path, content as string);
  return readArtifact(slug, name);
}

const HTML_PIN = '<meta name="loom:pinned" content="true">';

/**
 * A pin is one line of the document's own metadata, so it travels with the file; nothing else in
 * the file is rewritten. The modification time is kept: pinning is not an edit, and lists sort by it.
 */
export function pinArtifact(slug: string, name: string, pinned: unknown): ArtifactDetail {
  const path = artifactPath(slug, name);
  const text = readText(path) ?? bad("no such artifact", 404);
  const { mtime } = statSync(path);
  const md = artifactKind(name) === "md";
  let out = md ? text.replace(/^(---\r?\n)pinned: true\r?\n/, "$1") : text.replace(`\n${HTML_PIN}`, "");
  if (pinned) {
    if (md) out = /^---\r?\n/.test(out) ? out.replace(/^---\r?\n/, (open) => `${open}pinned: true\n`) : `---\npinned: true\n---\n\n${out}`;
    else if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (head) => `${head}\n${HTML_PIN}`);
    else bad("this page has no <head> to hold the pin");
  }
  writeAtomic(path, out);
  utimesSync(path, mtime, mtime);
  return readArtifact(slug, name);
}

const fileSlug = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");

/** A blank document (no content) or an upload (content plus its original filename). */
export function createArtifact(
  slug: string,
  input: { title?: unknown; content?: unknown; filename?: unknown; task?: unknown },
): ArtifactDetail {
  if (!isDir(projectDir(slug))) bad("no such project", 404);
  const upload = typeof input.filename === "string" && input.filename.trim() ? basename(input.filename.trim()) : undefined;
  const kind = upload ? artifactKind(upload) ?? bad("upload a .md or .html file") : "md";
  const task = input.task ? checkTaskId(input.task) : undefined;
  if (task && !readTask(slug, task)) bad(`task ${task} does not exist`);
  if (input.content !== undefined && typeof input.content !== "string") bad("content must be a string");
  let content = (input.content as string | undefined) ?? "";
  const titleIn = typeof input.title === "string" ? input.title.trim() : "";
  const stem = fileSlug(upload ? upload.replace(/\.(md|html?)$/i, "") : titleIn) || "untitled";
  if (!upload && !titleIn) bad("a document needs a title");

  if (kind === "md") {
    const fm = parseFrontmatter(content);
    const had = Object.keys(fm.data).length > 0;
    // A markdown upload without frontmatter acquires it; one that has it keeps its own.
    if (!had) {
      const title = titleIn || /^#\s+(.+)$/m.exec(fm.body)?.[1]?.trim() || stem;
      content = formatFrontmatter(
        { title, origin: "written", source: upload, task, created: today() },
        fm.body.trim() ? fm.body : `# ${title}\n`,
      );
    } else if (task && !fm.data.task) {
      content = formatFrontmatter({ ...fm.data, task }, fm.body);
    }
  }
  const prefix = task && !stem.startsWith(task.toLowerCase()) ? `${task.toLowerCase()}-` : "";
  const ext = kind === "md" ? ".md" : ".html";
  let name = `${prefix}${stem}${ext}`;
  for (let n = 2; existsSync(join(artifactsDir(slug), name)); n++) name = `${prefix}${stem}-${n}${ext}`;
  writeAtomic(join(artifactsDir(slug), name), content);
  return readArtifact(slug, name);
}

export function deleteArtifact(slug: string, name: string) {
  const path = artifactPath(slug, name);
  if (!existsSync(path)) bad("no such artifact", 404);
  trash(path, slug);
}

// ---------- memory ----------

const memoryDir = (slug: string) => join(projectDir(slug), "memory");
const MEMORY_TYPES = ["project", "decision", "people", "reference", "note"];
const MEMORY_FILE_RE = /^[a-z0-9][a-z0-9-]*\.md$/;

export function listMemory(slug: string): MemoryEntry[] {
  const entries = listDir(memoryDir(slug))
    .filter((f) => f.endsWith(".md") && f !== "MEMORY.md" && isSafeFile(f))
    .map((file): MemoryEntry | undefined => {
      const text = readText(join(memoryDir(slug), file));
      if (text === undefined) return undefined;
      const { data, body } = parseFrontmatter(text);
      return {
        file,
        name: data.name || /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || file.replace(/\.md$/, ""),
        description: data.description ?? "",
        // Unknown types show up as unsorted notes.
        type: MEMORY_TYPES.includes(data.type ?? "") ? data.type! : "note",
        body: body.trim(),
        source: data.source || undefined,
        updated: data.updated || undefined,
        over: memoryOver(data.description ?? "", body),
      };
    })
    .filter((e): e is MemoryEntry => !!e);
  return entries.sort(
    (a, b) => MEMORY_TYPES.indexOf(a.type) - MEMORY_TYPES.indexOf(b.type) || a.name.localeCompare(b.name),
  );
}

/** Regenerates MEMORY.md, writing only when its contents change. */
export function rebuildMemoryIndex(slug: string) {
  const dir = memoryDir(slug);
  if (!isDir(projectDir(slug))) return;
  const entries = listMemory(slug);
  const lines = ["# Memory index", "", "Generated by Loom from the entries in this folder. Do not edit this file; edit the entries.", ""];
  if (!entries.length) lines.push("No entries yet.", "");
  for (const type of MEMORY_TYPES) {
    const group = entries.filter((e) => e.type === type);
    if (!group.length) continue;
    lines.push(`## ${type}`, "");
    for (const e of group) {
      const origin = [e.source && `source ${e.source}`, e.updated && `checked ${e.updated}`].filter(Boolean).join(", ");
      lines.push(
        `- [${e.name}](${e.file}): ${e.description.replace(/\s+/g, " ") || "(no description)"}` +
          (origin ? ` (${origin})` : "") + (e.over ? ` **Over length: ${e.over}.**` : ""),
      );
    }
    lines.push("");
  }
  const text = lines.join("\n");
  if (readText(join(dir, "MEMORY.md")) !== text) writeAtomic(join(dir, "MEMORY.md"), text);
}

/** Creates an entry (no `file`) or rewrites an existing one. */
export function saveMemory(
  slug: string, file: string | undefined,
  input: { name?: unknown; description?: unknown; type?: unknown; body?: unknown },
): MemoryEntry {
  if (!isDir(projectDir(slug))) bad("no such project", 404);
  const str = (v: unknown, what: string) => (typeof v === "string" ? v.trim() : bad(`${what} must be a string`));
  const description = str(input.description ?? "", "description").replace(/\s+/g, " ");
  if (!description) bad("an entry needs a one-line description stating the fact");
  const type = MEMORY_TYPES.includes(input.type as string) ? (input.type as string) : "note";
  const body = str(input.body ?? "", "body");
  let target = file;
  let name: string;
  let source: string | undefined;
  if (target) {
    if (!isSafeFile(target) || !target.endsWith(".md") || target === "MEMORY.md") bad("invalid memory entry");
    if (!existsSync(join(memoryDir(slug), target))) bad("no such memory entry", 404);
    source = parseFrontmatter(readText(join(memoryDir(slug), target)) ?? "").data.source;
    name = str(input.name ?? "", "name") || target.replace(/\.md$/, "");
  } else {
    name = fileSlug(str(input.name ?? "", "name") || description.split(/\s+/).slice(0, 6).join(" "));
    if (!name) bad("an entry needs a name");
    target = `${name}.md`;
    if (!MEMORY_FILE_RE.test(target)) bad("invalid memory entry name");
    if (existsSync(join(memoryDir(slug), target))) bad(`an entry named "${name}" already exists; edit it instead`, 409);
  }
  writeAtomic(join(memoryDir(slug), target), formatFrontmatter({ name, description, type, source, updated: today() }, body));
  rebuildMemoryIndex(slug);
  return listMemory(slug).find((e) => e.file === target)!;
}

export function deleteMemory(slug: string, file: string) {
  if (!isSafeFile(file) || !file.endsWith(".md") || file === "MEMORY.md") bad("invalid memory entry");
  const path = join(memoryDir(slug), file);
  if (!existsSync(path)) bad("no such memory entry", 404);
  trash(path, slug);
  rebuildMemoryIndex(slug);
}

// ---------- graph ----------

/** `[[address]]` anywhere, or a bare task id in prose, since its shape is unambiguous. */
const LINK_RE = /\[\[([^\]\n]+)\]\]|\b(T-\d{3,})\b/g;
/** Run ids stay out of the graph: no reader opens a transcript. */
const RUN_ID_RE = /\b\d{14}-[a-z0-9]{4}\b/g;

export const approxTokens = (chars: number) =>
  chars >= 4000 ? `~${(chars / 4000).toFixed(1)}K tokens` : `~${Math.round(chars / 4)} tokens`;

/** A markdown file's headings; a section runs to the next heading at its level or above. */
export function outline(text: string): Section[] {
  const lines = text.split("\n");
  const heads: { level: number; heading: string; from: number }[] = [];
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const m = fenced ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) heads.push({ level: m[1]!.length, heading: m[2]!, from: i + 1 });
  });
  return heads.map((h, i) => {
    const next = heads.slice(i + 1).find((n) => n.level <= h.level);
    const to = next ? next.from - 1 : lines.length;
    return { ...h, to, tokens: Math.round(lines.slice(h.from - 1, to).join("\n").length / 4) };
  });
}

/** A section is named by the start of its heading, so `#T1` survives the heading being reworded after the number. */
const hasSection = (text: string, section?: string) =>
  !section || outline(text).some((s) => s.heading.toLowerCase().startsWith(section.toLowerCase()));

/**
 * A project's nodes, each with its one-line card, and its edges: derived from the files and run
 * records on every call, never stored. A Thread is numbered by the order of its task's run events.
 */
export function projectGraph(slug: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const p = readProject(slug);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const texts: { from: string; text: string; time?: string }[] = [];

  const tasks = listTasks(slug);
  for (const t of tasks) {
    const log = readTimeline(slug, t.id);
    const runs = threadsOf(slug, t.id, log);
    const threads = runs.map(({ address, time, run }, i) => {
      const state = run?.status ?? "unknown";
      const until = runs[i + 1]?.time ?? "~";
      // A report is signed by the Thread; older ones, signed "agent", belong to the Thread that was running.
      const report = log.filter((e) => e.type === "comment" && (e.by === address || (e.by === "agent" && e.time >= time && e.time < until))).pop();
      const line = report?.body.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim().slice(0, 100).replace(/"/g, "'");
      const turns = run && state !== "running" && state !== "queued" ? `  ${run.turns} turns` : "";
      const purpose = run?.purpose ? `  "${run.purpose.slice(0, 100).replace(/"/g, "'")}"` : "";
      return { address, time, state, card: `${address}${purpose}  ${state}${turns}${line ? `  report "${line}"` : ""}` };
    });
    const counts = new Map<string, number>();
    for (const th of threads) counts.set(th.state, (counts.get(th.state) ?? 0) + 1);
    const summary = threads.length
      ? `${threads.length} Thread${threads.length > 1 ? "s" : ""}: ${[...counts].map(([s, n]) => `${n} ${s}`).join(", ")}`
      : "no Thread";
    // The status as read, derived blocks included, so a card that reads `todo` is work an agent can take.
    const block = blockOf(slug, t, tasks, log, runs);
    const waits = block ? `  waiting on ${block.on}: "${block.detail.replace(/"/g, "'")}"` : "";
    nodes.push({ address: t.id, kind: "task", card: `${t.id}  ${block ? "blocked" : t.status}  ${t.priority}  "${t.title}"  ${summary}${waits}` });
    if (t.id !== ROOT) edges.push({ from: t.id, rel: "part of", to: t.parent ?? ROOT });
    for (const a of t.after ?? []) {
      const [s, id] = a.includes("/") ? a.split("/") : [slug, a];
      const found = existsSync(join(projectsDir(), s!, "tasks", `${id}.md`));
      edges.push({ from: t.id, rel: "after", to: a, ...(found ? {} : { missing: true }) });
    }
    if (t.repo) edges.push({ from: t.id, rel: "in", to: `${t.repo}.md` });
    for (const th of threads) {
      nodes.push({ address: th.address, kind: "thread", card: th.card });
      edges.push({ from: th.address, rel: "weaves", to: t.id, time: th.time });
    }
    // A Thread's finish lists what it wrote.
    for (const e of log) {
      const wrote = e.type === "run" && /^T-\d+\.\d+$/.test(e.by) ? /· wrote (.+?) · run/.exec(e.detail)?.[1] : undefined;
      for (const to of wrote?.split(", ") ?? []) edges.push({ from: e.by, rel: "wrote", to, time: e.time });
    }
    texts.push({ from: t.id, text: t.body });
    for (const e of log) if (e.body) texts.push({ from: t.id, text: e.body, time: e.time });
  }

  const docs = new Map<string, string>();
  for (const a of listArtifacts(slug)) {
    const text = readText(join(artifactsDir(slug), a.name)) ?? "";
    // Metadata names the task already, and code shows syntax: links are read from the prose.
    const body = a.kind === "md" ? parseFrontmatter(text).body : text.replace(/<(head|pre|code|script|style)\b[\s\S]*?<\/\1>/gi, "");
    texts.push({ from: a.name, text: body });
    edges.push({ from: a.name, rel: "documents", to: a.task ?? ROOT });
    // A link or a repository has no body here, so no size and no sections.
    if (a.origin === "link") nodes.push({ address: a.name, kind: "link", card: `${a.name}  link ${sourceKind(a.source ?? "")}  "${a.title}"` });
    else if (a.origin === "repo") nodes.push({ address: a.name, kind: "repository", card: `${a.name}  repository  "${a.title}"` });
    else {
      if (a.kind === "md") docs.set(a.name, text);
      nodes.push({ address: a.name, kind: "document", card: `${a.name}  document  "${a.title}"  ${approxTokens(a.size)}${a.over ? "  Over length" : ""}` });
      const original = p.sources.find((s) => s.url === a.source);
      if (original) edges.push({ from: a.name, rel: "copy of", to: `${original.id}.md` });
    }
  }
  for (const m of listMemory(slug)) {
    const name = m.file.replace(/\.md$/, "");
    nodes.push({ address: name, kind: "memory", card: `${name}  memory  "${m.description}"` });
    edges.push({ from: name, rel: "known to", to: "T-000" });
    if (m.source) edges.push({ from: name, rel: "read from", to: `${m.source}.md` });
    texts.push({ from: name, text: `${m.description}\n${m.body}` });
  }

  const known = new Set(nodes.map((n) => n.address));
  const seen = new Set<string>();
  const links: { from: string; to: string; line: string; time?: string }[] = [];
  for (const { from, text, time } of texts) {
    let fenced = false;
    for (const line of text.split("\n")) {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      // Code shows the syntax rather than linking: skip fenced blocks and inline code.
      if (fenced) continue;
      for (const m of line.replace(/`[^`]*`/g, "").matchAll(LINK_RE)) links.push({ from, to: (m[1] ?? m[2]!).trim(), line, time });
    }
  }
  for (const { from, to, line, time } of links) {
    if (to === from || seen.has(`${from}|${to}`)) continue;
    seen.add(`${from}|${to}`);
    const [target = "", section] = to.split("#");
    const other = /^([a-z0-9][a-z0-9-]*)\/(T-\d+)$/.exec(target);
    const inRepo = /^([^:\s\/]+):(.+)$/.exec(target);
    let found: boolean;
    if (other) found = existsSync(join(projectsDir(), other[1]!, "tasks", `${other[2]}.md`));
    else if (inRepo) {
      // A file in a registered repository becomes a node the first time something links to it.
      const repo = p.repos.find((r) => r.name === inRepo[1]);
      const path = repo ? resolve(repo.path, inRepo[2]!) : "";
      const content = repo && path.startsWith(resolve(repo.path) + sep) ? readText(path) : undefined;
      found = content !== undefined && hasSection(content, section);
      if (found && !known.has(target)) {
        const title = /^#\s+(.+)$/m.exec(content!)?.[1]?.trim() ?? inRepo[2];
        nodes.push({ address: target, kind: "file", card: `${target}  file in ${repo!.name}.md  "${title}"  ${approxTokens(content!.length)}` });
        known.add(target);
      }
    } else found = known.has(target) && (!docs.has(target) || hasSection(docs.get(target)!, section));
    const context = line.replace(RUN_ID_RE, "").replace(/\s+/g, " ").replace(/"/g, "'").trim().slice(0, 100);
    edges.push({ from, rel: "mentions", to, ...(time ? { time } : {}), ...(found ? {} : { missing: true }), line: context });
  }
  return { nodes, edges };
}

/** Regenerates GRAPH.md: one line per node and per edge, so a grep for an address returns its card and every edge that touches it. */
export function writeGraph(slug: string) {
  if (!isDir(projectDir(slug))) return;
  const { nodes, edges } = projectGraph(slug);
  const edge = (e: GraphEdge) =>
    [e.from, e.rel, e.to, e.time?.slice(0, 16).replace("T", " "), e.missing && "missing", e.line && `"${e.line}"`].filter(Boolean).join(" | ");
  const text = [
    "# Graph", "",
    "Generated by Loom from this project's files; do not edit. Grep an address for its card and every edge that touches it.", "",
    "## Nodes", ...nodes.map((n) => n.card), "",
    "## Edges", ...edges.map(edge), "",
  ].join("\n");
  const file = join(projectDir(slug), "GRAPH.md");
  if (readText(file) !== text) writeAtomic(file, text);
}

// ---------- inbox ----------

const inboxDir = () => join(DATA, "inbox");

/** Saves a drop, trimmed and with a trailing newline, as `<timestamp>.md` and returns the filename. */
export function saveInbox(text: string): string {
  const base = stamp();
  for (let n = 0; ; n++) {
    const file = n ? `${base}-${n}.md` : `${base}.md`;
    try {
      writeFileSync(join(inboxDir(), file), text.trim() + "\n", { flag: "wx" });
      return file;
    } catch (e: any) {
      if (e?.code !== "EEXIST" || n > 20) throw e;
    }
  }
}

export function archiveInbox(file: string) {
  if (!existsSync(join(inboxDir(), file))) return;
  let dest = join(inboxDir(), "processed", file);
  if (existsSync(dest)) dest = join(inboxDir(), "processed", `${stamp()}-${file}`);
  renameSync(join(inboxDir(), file), dest);
}

// ---------- automations ----------

const automationsPath = () => join(DATA, "automations.json");

export const listAutomations = (): Automation[] => readJson<Automation[]>(automationsPath()) ?? [];

/** Replaces the automation with this id, or adds a new one when there is no id. */
export function saveAutomation(id: string | undefined, input: Record<string, unknown>): Automation {
  const all = listAutomations();
  if (id && !all.some((a) => a.id === id)) bad("no such automation", 404);
  const text = (v: unknown, what: string) => (typeof v === "string" && v.trim() ? v.trim() : bad(`an automation needs ${what}`));
  if (input.kind !== "command" && input.kind !== "claude") bad("kind must be command or claude");
  const time = typeof input.time === "string" ? input.time : "";
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) bad("time must be HH:MM or empty");
  const project = input.project ? checkSlug(input.project) : undefined;
  if (project && !isDir(projectDir(project))) bad("no such project", 404);
  const next: Automation = {
    id: id ?? randomId(6),
    name: text(input.name, "a name"),
    kind: input.kind as Automation["kind"],
    run: text(input.run, input.kind === "command" ? "a command" : "a prompt"),
    ...(project ? { project } : {}),
    time,
    enabled: input.enabled !== false,
  };
  writeJson(automationsPath(), id ? all.map((a) => (a.id === id ? next : a)) : [...all, next]);
  return next;
}

export function deleteAutomation(id: string) {
  const all = listAutomations();
  if (!all.some((a) => a.id === id)) bad("no such automation", 404);
  writeJson(automationsPath(), all.filter((a) => a.id !== id));
}
