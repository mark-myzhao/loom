// Local history: the data directory is its own git repository, committed after a quiet period.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA, loadState, saveState, today } from "./store";

const QUIET_MS = 30_000;
let chain: Promise<unknown> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;
let busy: () => boolean = () => false;

/** Every git command goes through one chain, so they never overlap. */
function git(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const run = async () => {
    const proc = Bun.spawn(
      [
        "git",
        // Pin the repository, so an enclosing checkout (the app's own, by default) is never touched.
        `--git-dir=${join(DATA, ".git")}`, `--work-tree=${DATA}`,
        "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
        "-c", "user.name=Loom", "-c", "user.email=loom@localhost",
        ...args,
      ],
      // Never wait on a credential prompt nobody can answer.
      { cwd: DATA, stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    );
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    return { code, out, err };
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

async function snapshot() {
  const add = await git("add", "-A");
  if (add.code !== 0) throw new Error(add.err.trim() || "git add failed");
  const staged = await git("diff", "--cached", "--name-only", "-z");
  const files = staged.out.split("\0").filter(Boolean);
  if (!files.length) return;
  const message = files.length === 1 ? `snapshot: ${files[0]}` : `snapshot: ${files.length} files`;
  const commit = await git("commit", "-q", "--no-verify", "-m", message);
  if (commit.code !== 0) throw new Error(commit.err.trim() || "git commit failed");
}

export async function initBackup(isBusy: () => boolean) {
  busy = isBusy;
  try {
    if (!existsSync(join(DATA, ".git"))) {
      const init = await git("init", "-q", "-b", "main");
      if (init.code !== 0) throw new Error(init.err.trim() || "git init failed");
    }
    await snapshot();
  } catch (e) {
    console.error("backup: could not initialise:", (e as Error).message);
  }
}

/** Called on every watched change: snapshot after 30 quiet seconds, once no run is queued or active. */
export function scheduleBackup() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (busy()) return scheduleBackup();
    snapshot().catch((e) => {
      console.error("backup:", (e as Error).message);
      // Another git process (an editor, a pull) holds the index for a moment: try again after the next quiet period.
      if ((e as Error).message.includes("index.lock")) scheduleBackup();
    });
  }, QUIET_MS);
}

const RETRY_MS = 60 * 60_000;
let lastPushAttempt = 0;

/**
 * Off-machine copy: if the data repository has an `origin` remote, push to it once per local day.
 * Called every minute; a failed or skipped attempt is retried after an hour.
 */
export async function pushIfDue() {
  const day = today();
  if (loadState().lastBackupPush === day || Date.now() - lastPushAttempt < RETRY_MS) return;
  lastPushAttempt = Date.now();
  if ((await git("remote", "get-url", "origin")).code !== 0) return;
  if (!busy()) await snapshot();
  const push = await git("push", "-q", "origin", "HEAD:refs/heads/main");
  if (push.code !== 0) throw new Error(push.err.trim() || "git push failed");
  saveState({ lastBackupPush: day });
  console.log(`backup: pushed to origin (${day})`);
}
