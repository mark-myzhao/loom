// Runs the real server on a scratch data directory, with a stand-in for the claude binary.

import { afterAll, expect, test } from "bun:test";
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const data = mkdtempSync(join(tmpdir(), "loom-test-"));
const port = 4500 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}/api`;
// Answers each input message with a result, as Claude Code does with stream-json input, and logs
// what it was sent. "SLOW" in a message holds the answer for a second; "MARK" sets the task to review.
const fakeClaude = join(data, "fake-claude.sh");
const sent = join(data, "fake-claude.log");
const taskFile = join(data, "projects", "notes-demo", "tasks", "T-001.md");
writeFileSync(fakeClaude, `#!/bin/sh
echo '{"type":"system","subtype":"init","session_id":"s-1","cwd":"'"$PWD"'"}'
while read -r line; do
  printf '%s\\n' "$line" >> "${sent}"
  case "$line" in *SLOW*) sleep 1;; esac
  case "$line" in *MARK*) sed -i.bak 's/^status: .*/status: review/' "${taskFile}";; esac
  echo '{"type":"result","result":"Noted.","is_error":false}'
done
`);
chmodSync(fakeClaude, 0o755);
writeFileSync(join(data, "config.json"), JSON.stringify({ claudeBin: fakeClaude }));

let server: ReturnType<typeof Bun.spawn> | undefined;
async function start() {
  server = Bun.spawn(["bun", join(import.meta.dir, "index.ts")], {
    env: { ...process.env, PORT: String(port), DASH_DATA_DIR: data }, stdout: "ignore", stderr: "inherit",
  });
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${base}/state`).then((r) => r.ok, () => false)) return;
    await Bun.sleep(50);
  }
  throw new Error("the server did not start");
}
async function stop() {
  server?.kill();
  await server?.exited;
}
afterAll(async () => {
  await stop();
  rmSync(data, { recursive: true, force: true });
});

const call = async (method: string, path: string, body?: unknown, owner = "") =>
  (await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", "X-Loom-Owner": owner }, body: body === undefined ? undefined : JSON.stringify(body),
  })).json() as Promise<any>;

async function until(runId: string, status: string) {
  for (let i = 0; i < 100 && (await call("GET", `/runs/${runId}`)).status !== status; i++) await Bun.sleep(50);
}

async function say(text: string): Promise<string> {
  const run = await call("POST", "/shuttle", { text });
  await until(run.id, "done");
  return run.id;
}

test("a message within the hour resumes the Shuttle; one after it starts fresh with the hand-over", async () => {
  await start();
  const p = await call("POST", "/projects", { name: "Demo" });
  await call("POST", `/projects/${p.slug}/tasks`, { title: "Review the draft", status: "review" });

  const first = await say("file the draft");
  expect(await say("and remind me tomorrow")).toBe(first);

  // An idle hour passes.
  await stop();
  const metaFile = join(data, "runs", `${first}.json`);
  const meta = JSON.parse(readFileSync(metaFile, "utf8"));
  meta.endedAt = new Date(Date.now() - 2 * 3600_000).toISOString();
  writeFileSync(metaFile, JSON.stringify(meta));
  await start();

  const next = await say("what needs me?");
  expect(next).not.toBe(first);
  const prompt = JSON.parse(readFileSync(join(data, "runs", `${next}.jsonl`), "utf8").split("\n")[0]!).text as string;
  expect(prompt).toStartWith("Loom: ");
  expect(prompt).toContain(`T-001 ${p.slug} "Review the draft" · review`);
  expect(prompt).toContain("  me: and remind me tomorrow");
  expect(prompt).toContain("  Shuttle: Noted.");
  expect(prompt).toEndWith("\n---\nwhat needs me?");
  expect(readFileSync(join(data, "SESSIONS.md"), "utf8")).toContain(`"file the draft"  wrote nothing`);
}, 30_000);

test("a note reaches a running Thread; only the owner's note wakes an ended one", async () => {
  const repo = mkdtempSync(join(tmpdir(), "loom-repo-"));
  const p = await call("POST", "/projects", { name: "Notes demo" });
  await call("POST", `/projects/${p.slug}/tasks`, { title: "Port it", body: "## Context\nSLOW\n" });
  const tasks = `/projects/${p.slug}/tasks/T-001`;
  expect((await call("GET", `/projects/${p.slug}/tasks/T-000`)).children.map((t: any) => t.id)).toEqual(["T-001"]);

  expect((await call("POST", `${tasks}/delegate`, { repoPath: repo })).error).toBe("only the owner starts a Thread");
  const browser = await fetch(`${base}/owner`, { headers: { "Sec-Fetch-Site": "same-origin" } });
  const { token } = (await browser.json()) as any;
  expect((await fetch(`${base}/owner`)).status).toBe(403);

  const run = await call("POST", `${tasks}/delegate`, { repoPath: repo }, token);
  await until(run.id, "running");
  expect((await call("POST", `${tasks}/note`, { text: "skip Windows" }, token)).delivered).toBe(1);
  await until(run.id, "done");
  expect(readFileSync(sent, "utf8")).toContain("Note from the owner: skip Windows");

  // Ended: an agent's note is recorded and starts nothing; the owner's resumes the warm Thread.
  expect((await call("POST", `${tasks}/note`, { text: "FYI the API moved" })).delivered).toBe(0);
  expect((await call("GET", `/runs/${run.id}`)).status).toBe("done");
  const resumed = await call("POST", `${tasks}/note`, { text: "MARK it for review" }, token);
  expect(resumed.run.id).toBe(run.id);
  await until(run.id, "done");
  await Bun.sleep(100);

  const log = readFileSync(join(data, "projects", p.slug, "tasks", "T-001.log.md"), "utf8");
  expect(log).toContain("| me | note -->\nskip Windows");
  expect(log).toContain("| agent | note -->\nFYI the API moved");
  expect(log).toMatch(/\| T-001\.1 \| status \| in-progress -> review/);
  expect(log).toMatch(/\| T-001\.1 \| run \| done · run /);
  expect(existsSync(join(data, "projects", p.slug, "GRAPH.md"))).toBe(true);

  // The Thread asks; the board shows it first, and the owner's answer clears it.
  appendFileSync(join(data, "projects", p.slug, "tasks", "T-001.log.md"), `\n<!-- event: ${new Date().toISOString()} | T-001.1 | question -->\nKeep the old route?\n`);
  const asks = (await call("GET", "/state")).board.find((r: any) => r.project === p.slug && r.taskId === "T-001");
  expect(asks).toMatchObject({ address: "T-001.1", state: "asks", detail: "Keep the old route?" });
  await call("POST", `${tasks}/note`, { text: "Yes, keep it", thread: "T-001.1" }, token);
  await until(run.id, "done");
  expect((await call("GET", "/state")).board.find((r: any) => r.project === p.slug && r.taskId === "T-001")).toMatchObject({ address: "T-001.1", state: "review" });

  // Blocked needs a comment; Unblock returns a task with no Thread to todo.
  expect((await call("POST", `/projects/${p.slug}/tasks`, { title: "Wait", status: "blocked" })).error).toContain("needs a comment");
  const wait = await call("POST", `/projects/${p.slug}/tasks`, { title: "Wait", status: "blocked", comment: "Dana approves the API" });
  expect((await call("GET", "/state")).board.find((r: any) => r.taskId === wait.id && r.project === p.slug))
    .toMatchObject({ group: "Waiting on human", state: "blocked", detail: "Dana approves the API" });
  expect((await call("POST", `/projects/${p.slug}/tasks/${wait.id}/unblock`, {}, token)).status).toBe("todo");

  // On a task its Thread blocked, Unblock is Continue: in-progress, and the owner's note resumes the Thread.
  writeFileSync(taskFile, readFileSync(taskFile, "utf8").replace(/^status: .*$/m, "status: blocked"));
  appendFileSync(join(data, "projects", p.slug, "tasks", "T-001.log.md"), `\n<!-- event: ${new Date().toISOString()} | T-001.1 | status | review -> blocked -->\n`);
  expect((await call("POST", `${tasks}/unblock`, { text: "Dana said yes" }, token)).run.id).toBe(run.id);
  await until(run.id, "done");
  expect(readFileSync(taskFile, "utf8")).toContain("status: in-progress");
}, 30_000);

test("telemetry logs writes with who made them, runs, and the dashboard's views, outside the snapshots", async () => {
  await call("POST", "/telemetry", { events: [{ ev: "view", tab: "t1", route: "#/usage" }, { ev: "api", path: "/forged" }] });
  await Bun.sleep(100);
  const log: any[] = await call("GET", "/telemetry");
  expect(log.filter((e) => e.src === "web")).toMatchObject([{ ev: "view", route: "#/usage" }]);
  expect(log.find((e) => e.path === "/forged")).toBeUndefined();
  expect(log).toContainEqual(expect.objectContaining({ ev: "api", method: "POST", path: "/api/projects/notes-demo/tasks/T-001/note", actor: "owner", status: 200 }));
  expect(log).toContainEqual(expect.objectContaining({ ev: "api", path: "/api/projects/notes-demo/tasks/T-001/note", actor: "agent" }));
  expect(log).toContainEqual(expect.objectContaining({ ev: "run.end", kind: "task", taskId: "T-001", status: "done" }));
  expect(log.some((e) => JSON.stringify(e).includes("skip Windows"))).toBe(false);
  expect(readFileSync(join(data, ".gitignore"), "utf8")).toContain("telemetry/");
});
