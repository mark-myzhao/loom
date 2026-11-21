// Local history: the data directory is its own git repository, committed after a quiet period.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./store";

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
      { cwd: DATA, stdout: "pipe", stderr: "pipe", stdin: "ignore" },
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
    snapshot().catch((e) => console.error("backup:", (e as Error).message));
  }, QUIET_MS);
}
