// Shared record types. The browser imports this file for types only.

export type ProjectStatus = "active" | "paused" | "done";
export type TaskStatus = "todo" | "in-progress" | "blocked" | "review" | "done" | "cancelled";
export type Priority = "p0" | "p1" | "p2" | "p3";
export type SourceKind = "gdoc" | "slack" | "github" | "url" | "note";

export const TASK_STATUSES: TaskStatus[] = ["todo", "in-progress", "blocked", "review", "done", "cancelled"];
/** Done or cancelled: no longer open, holds no other task, off the board. */
export const isClosed = (s: TaskStatus) => s === "done" || s === "cancelled";
export const PRIORITIES: Priority[] = ["p0", "p1", "p2", "p3"];
export const PROJECT_STATUSES: ProjectStatus[] = ["active", "paused", "done"];
export const SOURCE_KINDS: SourceKind[] = ["gdoc", "slack", "github", "url", "note"];

export interface Source {
  id: string;
  kind: SourceKind;
  url: string;
  title?: string;
  addedAt: string;
}

export interface Repo {
  name: string;
  path: string;
}

export interface Project {
  slug: string;
  name: string;
  status: ProjectStatus;
  summary: string;
  repos: Repo[];
  sources: Source[];
  createdAt?: string;
  updatedAt?: string;
  /** Set in memory only, when project.json could not be read. */
  error?: string;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  created?: string;
  updated?: string;
  due?: string;
  parent?: string;
  /** Task addresses (`T-005`, `other-slug/T-004`) it waits on until they are done. */
  after?: string[];
  source?: string;
  repo?: string;
  run?: string;
  body: string;
  /** The start of the Context section, for hover cards. */
  excerpt: string;
  /** Checked and total checklist items across the whole body. */
  checked: number;
  total: number;
}

/** A task as sent in the root snapshot: everything but the body. */
export type TaskSummary = Omit<Task, "body">;

export type Actor = "me" | "claude" | "agent" | "shuttle";

export interface TimelineEvent {
  time: string;
  by: string;
  type: string;
  detail: string;
  body: string;
}

export interface Artifact {
  name: string;
  kind: "md" | "html";
  title: string;
  origin?: string;
  task?: string;
  source?: string;
  created?: string;
  modifiedAt: string;
  size: number;
  /** What to do, when the document is over length. */
  over?: string;
}

export interface MemoryEntry {
  file: string;
  name: string;
  description: string;
  type: string;
  body: string;
  /** The id of the project source the fact was read from, if any. */
  source?: string;
  /** The date the entry was last written or checked against its source. */
  updated?: string;
  /** What to trim, when the entry is over the length limits. */
  over?: string;
}

/** Word counts past which an entry is flagged. The conventions ask for 20 and 80; this is the slack. */
export const MEMORY_LIMITS = { description: 25, body: 100 };

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Says which parts of an entry are over length, or nothing when it fits. */
export function memoryOver(description: string, body: string): string | undefined {
  const over = [
    words(description) > MEMORY_LIMITS.description && `the description to 20 words (now ${words(description)})`,
    words(body) > MEMORY_LIMITS.body && `the body to 80 words (now ${words(body)})`,
  ].filter(Boolean);
  return over.length ? `trim ${over.join(" and ")}` : undefined;
}

/** Something the owner set up to run on demand or every day: a shell command or a Claude prompt. */
export interface Automation {
  id: string;
  name: string;
  kind: "command" | "claude";
  /** The shell command, or the instructions for the Claude session. */
  run: string;
  /** Runs in this project's directory; the data directory without one. */
  project?: string;
  /** Local "HH:MM" to run at every day. Empty: only when started by hand. */
  time: string;
  enabled: boolean;
}

export type RunKind = "automation" | "ingest" | "ask" | "artifact" | "task" | "shuttle";
export type RunStatus = "queued" | "running" | "done" | "failed" | "stopped" | "interrupted";

export interface RunSpec {
  cwd: string;
  permissionMode: string;
  allowedTools: string[];
  disallowedTools?: string[];
  model?: string;
  addDirs?: string[];
  /** Plugins loaded for this session only, such as the skills Loom gives every Thread. */
  pluginDirs?: string[];
  worktree?: string;
  /** The prompt is a shell command to run, not instructions for Claude. */
  shell?: boolean;
  /** Standing instructions, passed again on every resume; the prompt is then only the owner's message. */
  systemPrompt?: string;
}

export interface RunMeta {
  id: string;
  kind: RunKind;
  title: string;
  status: RunStatus;
  createdAt: string;
  costUsd: number;
  turns: number;
  spec: RunSpec;
  project?: string;
  taskId?: string;
  startedAt?: string;
  endedAt?: string;
  sessionId?: string;
  sessionCwd?: string;
  /** A Thread's purpose: the line the owner gave at Start. */
  purpose?: string;
  result?: string;
  /** When the session last returned a result: a note recorded after it never reached the session. */
  resultAt?: string;
  error?: string;
  usage?: RunUsage[];
  /** The largest prompt the main session sent, in tokens: how full its context got. */
  peakContext?: number;
}

/** What one start or resume of a run's session used on one model. Token counts; cache writes and reads are apart from `input`. */
export interface RunUsage {
  /** When that start or resume was sent. */
  at: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

export interface Config {
  ownerName: string;
  claudeBin: string;
  maxConcurrentRuns: number;
  /** The Shuttle, Loom's resident agent. Empty uses the CLI default. */
  shuttleModel: string;
  /** Sessions that read sources and edit the data files: drops, questions, documents, Claude automations. */
  reader: {
    model: string;
    permissionMode: string;
    allowedTools: string[];
    disallowedTools: string[];
    /** The "How to fetch sources" paragraph included in their prompts. */
    fetchInstructions: string;
  };
  agent: {
    model: string;
    permissionMode: string;
    allowedTools: string[];
    useWorktree: boolean;
  };
  /** Log views, clicks, API writes and runs to telemetry/ in the data directory. On unless false. */
  telemetry?: boolean;
}

/** Idle this long, the one-hour prompt cache is gone: a fresh Shuttle session costs less than a resume. */
export const CACHE_COLD_MS = 55 * 60_000;

/** A model and effort for one message, over the run's own; empty keeps the run's. Pinned ids, so a session does not drift. */
export type Override = { model?: string; effort?: string };
export const MODELS = [
  { value: "claude-fable-5-2", label: "Fable 5.2" },
  { value: "claude-opus-5-5", label: "Opus 5.5" },
  { value: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { value: "claude-haiku-5-5", label: "Haiku 5.5" },
];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/** A Shuttle message is Loom's context, a "---" line, then the owner's own words. */
export function ownerText(message: string): string {
  const i = message.indexOf("\n---\n");
  return i < 0 ? message : message.slice(i + 5);
}

export interface AppState {
  /** Automation id to the local date its daily run was last started. */
  automationRan?: Record<string, string>;
  /** Local date of the last successful push of the data repository to its remote. */
  lastBackupPush?: string;
  /** The run that holds the current Shuttle conversation. */
  shuttle?: string;
}

/** A Thread's state, never stored: derived from its run and the timeline (states.md). */
export const THREAD_STATES = ["queued", "running", "asks", "ended", "failed"] as const;
export type ThreadState = (typeof THREAD_STATES)[number];

/** The Threads board's groups, in order: a view over task status and Thread state. */
export const BOARD_GROUPS = ["Waiting on human", "Working", "Ready", "Waiting on task"] as const;

/** One row of the Threads board: a live Thread, or a task in one of the other groups. */
export interface BoardRow {
  project: string;
  taskId: string;
  title: string;
  group: (typeof BOARD_GROUPS)[number];
  /** What the row shows: the task's status, or the state of its Thread. */
  state: TaskStatus | ThreadState;
  /** The question, the block, the run's figures, the latest report line or the task's context. */
  detail: string;
  address?: string;
  runId?: string;
}

export interface ProjectSnapshot extends Project {
  tasks: TaskSummary[];
}

/** GET /api/state */
export interface Snapshot {
  dataDir: string;
  config: Config;
  /** The model Claude Code uses when none is passed (an id or an alias), from ~/.claude/settings.json; empty when unset. */
  cliModel: string;
  /** The effort Claude Code uses when none is passed, by model ("" for any model), from ~/.claude/settings.json. */
  cliEffort: Record<string, string>;
  automations: Automation[];
  lastBackupPush?: string;
  /** The run that holds the current Shuttle conversation, if one has started. */
  shuttle?: RunMeta;
  projects: ProjectSnapshot[];
  /** The most recent runs, newest first (at most 150). */
  runs: RunMeta[];
  board: BoardRow[];
}

/** GET /api/projects/<slug>/tasks/<id> */
export interface TaskDetail {
  task: Task;
  timeline: TimelineEvent[];
  /** Outermost first. */
  ancestors: { id: string; title: string; status: TaskStatus; context: string; artifacts: Artifact[] }[];
  children: TaskSummary[];
  artifacts: Artifact[];
  runs: RunMeta[];
  /** What links to this task or one of its Threads, with the line around each link. */
  linkedFrom: { from: string; line: string }[];
}

/** One thing in a project's graph, by the address a link names, with its one-line card. */
export interface GraphNode {
  address: string;
  kind: "task" | "thread" | "document" | "link" | "repository" | "file" | "memory";
  card: string;
}

/** Derived from a field, the timeline or a `[[link]]`; `line` is the text around a link. */
export interface GraphEdge {
  from: string;
  rel: string;
  to: string;
  time?: string;
  line?: string;
  missing?: boolean;
}

/** A heading of a markdown file, with its 1-based line range and size. */
export interface Section {
  level: number;
  heading: string;
  from: number;
  to: number;
  tokens: number;
}

export interface ArtifactDetail extends Artifact {
  content: string;
}
