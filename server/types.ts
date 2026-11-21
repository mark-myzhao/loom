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
  lastSyncedAt?: string;
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
  lastSyncedAt?: string;
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
}

export interface InboxNote {
  file: string;
  text: string;
  modifiedAt: string;
}

export type RunKind = "sync" | "ingest" | "ask" | "artifact" | "task" | "setup";
export type RunStatus = "queued" | "running" | "done" | "failed" | "stopped" | "interrupted";

export interface RunSpec {
  cwd: string;
  permissionMode: string;
  allowedTools: string[];
  disallowedTools?: string[];
  model?: string;
  addDirs?: string[];
  worktree?: string;
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
  schedule: { enabled: boolean; time: string };
  /** Backends the setup run enables on the gateway. Empty skips the step. */
  connectors: string[];
  /** MCP server that fronts the connectors and needs the enable step. Empty skips it. */
  connectorGateway: string;
  sync: {
    model: string;
    permissionMode: string;
    allowedTools: string[];
    disallowedTools: string[];
    /** The "How to fetch sources" paragraph used by sync-type prompts. */
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
  lastDailySync?: string;
  /** Local date of the last successful push of the data repository to its remote. */
  lastBackupPush?: string;
  connectors?: string;
}

export interface ProjectSnapshot extends Project {
  tasks: TaskSummary[];
  pendingNotes: number;
}

/** GET /api/state */
export interface Snapshot {
  dataDir: string;
  config: Config;
  lastDailySync?: string;
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
