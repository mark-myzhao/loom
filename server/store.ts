// The filesystem is the database. This module is the only reader/writer of records.
// A format change here must be mirrored in conventions.md and prompts.ts.

import {
  appendFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, readSync, readdirSync,
  renameSync, statSync, writeFileSync, writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  memoryOver, PRIORITIES, PROJECT_STATUSES, SOURCE_KINDS, TASK_STATUSES,
  type AppState, type Artifact, type ArtifactDetail, type Automation, type Config, type MemoryEntry,
  type GraphEdge, type GraphNode, type Priority, type Project, type Repo, type RunMeta, type Section, type Source,
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

export const DEFAULT_GATEWAY = "gateway";
const GATEWAY_TOOLS = [
  "slack_who_am_i", "slack_read_thread", "slack_read_channel", "slack_read_conversation_info",
  "slack_read_canvas", "slack_read_file", "slack_read_user_profile", "slack_search_channels",
  "slack_search_users", "slack_search_public_and_private",
  "gws_docs_read", "gws_docs_get_structure", "gws_docs_list_comments", "gws_drive_get", "gws_drive_search",
  "gws_drive_list", "gws_drive_export", "gws_sheets_read", "gws_sheets_list_tabs", "gws_slides_read",
  "gws_calendar_get", "gws_calendar_list",
  "github_pull_request_read", "github_issue_read", "github_content_read", "github_list_pull_requests",
  "github_search_pull_requests", "github_search_issues",
];

export const DEFAULT_FETCH_INSTRUCTIONS = `How to fetch sources:
- Slack: call slack_who_am_i first (required before any other Slack tool), then slack_read_thread / slack_read_channel with the link.
- Google Docs, Sheets, Slides: the gws_docs_read / gws_sheets_read / gws_slides_read tools (gws_drive_get for metadata and titles).
- GitHub links: the github_* read tools. Anything else: WebFetch.
- These tools may be deferred: load them with ToolSearch (e.g. "select:mcp__${DEFAULT_GATEWAY}__gws_docs_read") before concluding one is missing.
- If a source cannot be fetched (no access, tool missing), do not guess its content. Say so in your final summary.`;

export const DEFAULT_CONFIG: Config = {
  ownerName: "",
  claudeBin: "claude",
  maxConcurrentRuns: 3,
  connectors: ["slack", "gws", "github"],
  connectorGateway: DEFAULT_GATEWAY,
  reader: {
    model: "",
    permissionMode: "acceptEdits",
    allowedTools: [
      "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "ToolSearch",
      ...GATEWAY_TOOLS.map((t) => `mcp__${DEFAULT_GATEWAY}__${t}`),
    ],
    // Leaving Bash off the allow-list is not enough: acceptEdits auto-approves read-only shell commands.
    disallowedTools: ["Bash"],
    fetchInstructions: DEFAULT_FETCH_INSTRUCTIONS,
  },
  agent: {
    model: "",
    permissionMode: "auto",
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
    useWorktree: true,
  },
};

const configPath = () => join(DATA, "config.json");
const statePath = () => join(DATA, "state.json");

/** Stored values over defaults, one level deep for reader and agent. Read on every action. */
export function loadConfig(): Config {
  // "sync" is the former name of "reader", so settings saved under it still apply; "schedule" is gone.
  const { sync, schedule: _gone, ...s } = (readJson(configPath()) ?? {}) as Partial<Config> & { sync?: Partial<Config["reader"]>; schedule?: unknown };
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
  if (typeof next.ownerName !== "string" || typeof next.claudeBin !== "string" || !next.claudeBin.trim())
    bad("ownerName and claudeBin must be strings");
  next.maxConcurrentRuns = Math.round(Number(next.maxConcurrentRuns));
  if (!(next.maxConcurrentRuns >= 1 && next.maxConcurrentRuns <= 8)) bad("maxConcurrentRuns must be 1 to 8");
  next.connectors = strList(next.connectors, "connectors");
  if (typeof next.connectorGateway !== "string" || !/^[\w-]*$/.test(next.connectorGateway))
    bad("connectorGateway must be an MCP server name");
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
  const next = { ...loadState(), ...patch };
  writeJson(statePath(), next);
  return next;
}

const GITIGNORE = `# Loom: run history, runtime state and trash stay out of snapshots
runs/
state.json
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
  for (const slug of listProjectSlugs()) rebuildMemoryIndex(slug);
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

export function readProject(slug: string): Project {
  const file = join(projectDir(slug), "project.json");
  const base: Project = { slug, name: slug, status: "active", summary: "", repos: [], sources: [] };
  const text = readText(file);
  if (text === undefined) return { ...base, error: "project.json is missing" };
  let raw: any;
  try {
    raw = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
  } catch (e) {
    return { ...base, error: `project.json could not be read: ${(e as Error).message}` };
  }
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    slug,
    name: str(raw.name) || slug,
    status: PROJECT_STATUSES.includes(raw.status) ? raw.status : "active",
    summary: str(raw.summary) ?? "",
    repos: (Array.isArray(raw.repos) ? raw.repos : [])
      .filter((r: any) => r && typeof r.path === "string")
      .map((r: any): Repo => ({ name: str(r.name) || basename(r.path), path: r.path })),
    sources: (Array.isArray(raw.sources) ? raw.sources : [])
      .filter((s: any) => s && typeof s.url === "string")
      .map((s: any): Source => ({
        id: str(s.id) || randomId(6),
        kind: SOURCE_KINDS.includes(s.kind) ? s.kind : sourceKind(s.url),
        url: s.url,
        title: str(s.title),
        addedAt: str(s.addedAt) ?? "",
      })),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

/** Read-modify-write on the raw JSON, so unrelated fields survive. */
export function updateProject(slug: string, fn: (raw: Record<string, any>, p: Project) => void): Project {
  const p = readProject(slug);
  if (p.error) bad(p.error, 409);
  const raw = readJson<Record<string, any>>(join(projectDir(slug), "project.json"))!;
  raw.repos = p.repos;
  raw.sources = p.sources;
  fn(raw, p);
  raw.updatedAt = nowIso();
  writeJson(join(projectDir(slug), "project.json"), raw);
  return readProject(slug);
}

export function createProject(name: string): Project {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) bad("a project needs a name");
  const base = slugify(clean);
  let slug = base;
  for (let n = 2; existsSync(join(projectsDir(), slug)); n++) slug = `${base}-${n}`;
  const dir = join(projectsDir(), slug);
  for (const d of ["tasks", "memory", "artifacts"]) mkdirSync(join(dir, d), { recursive: true });
  const now = nowIso();
  writeJson(join(dir, "project.json"), {
    name: clean, status: "active", summary: "", repos: [], sources: [], createdAt: now, updatedAt: now,
  });
  rebuildMemoryIndex(slug);
  return readProject(slug);
}

export function patchProject(slug: string, patch: { name?: unknown; status?: unknown; summary?: unknown }): Project {
  return updateProject(slug, (raw) => {
    if (patch.name !== undefined) {
      if (typeof patch.name !== "string" || !patch.name.trim()) bad("name must be a non-empty string");
      raw.name = (patch.name as string).trim();
    }
    if (patch.status !== undefined) {
      if (!PROJECT_STATUSES.includes(patch.status as any)) bad("status must be active, paused or done");
      raw.status = patch.status;
    }
    if (patch.summary !== undefined) {
      if (typeof patch.summary !== "string") bad("summary must be a string");
      raw.summary = (patch.summary as string).trim();
    }
  });
}

export function deleteProject(slug: string) {
  const dir = projectDir(slug);
  if (!isDir(dir)) bad("no such project", 404);
  trash(dir, slug);
}

export function addSource(slug: string, url: unknown, title?: unknown): Project {
  if (typeof url !== "string" || !/^https?:\/\/\S+$/i.test(url.trim())) bad("a source needs an http(s) url");
  const u = (url as string).trim();
  return updateProject(slug, (raw, p) => {
    if (p.sources.some((s) => s.url === u)) bad("that source is already registered", 409);
    const src: Source = { id: randomId(6), kind: sourceKind(u), url: u, addedAt: nowIso() };
    if (typeof title === "string" && title.trim()) src.title = title.trim();
    raw.sources = [...p.sources, src];
  });
}

export function removeSource(slug: string, id: string): Project {
  return updateProject(slug, (raw, p) => {
    if (!p.sources.some((s) => s.id === id)) bad("no such source", 404);
    raw.sources = p.sources.filter((s) => s.id !== id);
  });
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
  const n = (typeof name === "string" && name.trim()) || basename(p);
  return updateProject(slug, (raw, proj) => {
    if (proj.repos.some((r) => r.name === n)) bad(`a codebase named "${n}" is already registered`, 409);
    raw.repos = [...proj.repos, { name: n, path: p }];
  });
}

export function removeRepo(slug: string, name: string): Project {
  return updateProject(slug, (raw, p) => {
    if (!p.repos.some((r) => r.name === name)) bad("no such codebase", 404);
    raw.repos = p.repos.filter((r) => r.name !== name);
  });
}

// ---------- tasks ----------

const TASK_KEYS = ["id", "parent", "title", "status", "priority", "due", "source", "repo", "run", "created", "updated"];
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

// ---------- task writes ----------

export interface TaskInput {
  title?: unknown; status?: unknown; priority?: unknown; due?: unknown; parent?: unknown;
  repo?: unknown; source?: unknown; body?: unknown; run?: unknown;
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
    return readTask(slug, id)!;
  }
}

export const TRACKED_FIELDS = ["priority", "due", "title", "repo", "parent"] as const;

/** Applies a patch and, when `by` is given, logs status and field changes on the timeline. */
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
 * records on every call, never stored. Until a project is a task, its root `T-000`, links and
 * repositories come from project.json, and a Thread is numbered by the order of its task's run events.
 */
export function projectGraph(slug: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const p = readProject(slug);
  const nodes: GraphNode[] = [{ address: "T-000", kind: "task", card: `T-000  project  ${p.status}  "${p.name}"` }];
  const edges: GraphEdge[] = [];
  const texts: { from: string; text: string; time?: string }[] = [];

  for (const t of listTasks(slug)) {
    const log = readTimeline(slug, t.id);
    const starts = log.filter((e) => e.type === "run" && e.detail.startsWith("started"));
    const threads = starts.map((start, i) => {
      const run = readJson<RunMeta>(join(runsDir(), `${/run (\S+)$/.exec(start.detail)?.[1]}.json`));
      const state = run?.status ?? "unknown";
      const until = starts[i + 1]?.time ?? "~";
      const address = `${t.id}.${i + 1}`;
      // A report is signed by the Thread; older ones, signed "agent", belong to the Thread that was running.
      const report = log.filter((e) => e.type === "comment" && (e.by === address || (e.by === "agent" && e.time >= start.time && e.time < until))).pop();
      const line = report?.body.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim().slice(0, 100).replace(/"/g, "'");
      const turns = run && state !== "running" && state !== "queued" ? `  ${run.turns} turns` : "";
      const purpose = run?.purpose ? `  "${run.purpose.slice(0, 100).replace(/"/g, "'")}"` : "";
      return { address, time: start.time, state, card: `${address}${purpose}  ${state}${turns}${line ? `  report "${line}"` : ""}` };
    });
    const counts = new Map<string, number>();
    for (const th of threads) counts.set(th.state, (counts.get(th.state) ?? 0) + 1);
    const summary = threads.length
      ? `${threads.length} Thread${threads.length > 1 ? "s" : ""}: ${[...counts].map(([s, n]) => `${n} ${s}`).join(", ")}`
      : "no Thread";
    nodes.push({ address: t.id, kind: "task", card: `${t.id}  ${t.status}  ${t.priority}  "${t.title}"  ${summary}` });
    edges.push({ from: t.id, rel: "part of", to: t.parent ?? "T-000" });
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
    if (a.kind === "md") docs.set(a.name, text);
    // Metadata names the task already; links are read from the body.
    const body = a.kind === "md" ? parseFrontmatter(text).body : text.replace(/<head[\s\S]*?<\/head>/i, "");
    nodes.push({ address: a.name, kind: "document", card: `${a.name}  document  "${a.title}"  ${approxTokens(a.size)}${a.over ? "  Over length" : ""}` });
    edges.push({ from: a.name, rel: "documents", to: a.task ?? "T-000" });
    const original = p.sources.find((s) => s.url === a.source);
    if (original) edges.push({ from: a.name, rel: "copy of", to: `${original.id}.md` });
    texts.push({ from: a.name, text: body });
  }
  for (const s of p.sources) nodes.push({ address: `${s.id}.md`, kind: "link", card: `${s.id}.md  link ${s.kind}  "${s.title ?? s.url}"` });
  for (const r of p.repos) nodes.push({ address: `${r.name}.md`, kind: "repository", card: `${r.name}.md  repository  "${r.name}"` });
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
