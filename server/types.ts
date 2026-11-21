// Shared record types. The browser imports this file for types only.

export type ProjectStatus = "active" | "paused" | "done";
export type TaskStatus = "todo" | "doing" | "review" | "blocked" | "done";
export type Priority = "p0" | "p1" | "p2" | "p3";
export type SourceKind = "gdoc" | "slack" | "github" | "url" | "note";

export const TASK_STATUSES: TaskStatus[] = ["todo", "doing", "review", "blocked", "done"];
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

export type Actor = "me" | "claude" | "agent";

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

export type RunKind = "automation" | "ingest" | "ask" | "artifact" | "task" | "setup";
export type RunStatus = "queued" | "running" | "done" | "failed" | "stopped" | "interrupted";

export interface RunSpec {
  cwd: string;
  permissionMode: string;
  allowedTools: string[];
  disallowedTools?: string[];
  model?: string;
  addDirs?: string[];
  worktree?: string;
  /** The prompt is a shell command to run, not instructions for Claude. */
  shell?: boolean;
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
  result?: string;
  error?: string;
}

export interface Config {
  ownerName: string;
  claudeBin: string;
  maxConcurrentRuns: number;
  /** Backends the setup run enables on the gateway. Empty skips the step. */
  connectors: string[];
  /** MCP server that fronts the connectors and needs the enable step. Empty skips it. */
  connectorGateway: string;
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
}

export interface AppState {
  /** Automation id to the local date its daily run was last started. */
  automationRan?: Record<string, string>;
  /** Local date of the last successful push of the data repository to its remote. */
  lastBackupPush?: string;
  connectors?: string;
}

export interface ProjectSnapshot extends Project {
  tasks: TaskSummary[];
}

/** GET /api/state */
export interface Snapshot {
  dataDir: string;
  config: Config;
  automations: Automation[];
  lastBackupPush?: string;
  projects: ProjectSnapshot[];
  /** The most recent runs, newest first (at most 150). */
  runs: RunMeta[];
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
}

export interface ArtifactDetail extends Artifact {
  content: string;
}
