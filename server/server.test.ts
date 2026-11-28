// Runs the real server on a scratch data directory, with a stand-in for the claude binary.

import { afterAll, expect, test } from "bun:test";
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const data = mkdtempSync(join(tmpdir(), "loom-test-"));
const port = 4500 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}/api`;
// Answers each input message with a result, as Claude Code does with stream-json input, and logs
// what it was sent. "SLOW" in a message holds the answer for a second; "MARK" sets the task to review;
// "OVERLOAD" answers with the API's 529.
const fakeClaude = join(data, "fake-claude.sh");
const sent = join(data, "fake-claude.log");
const taskFile = join(data, "projects", "notes-demo", "tasks", "T-001.md");
writeFileSync(fakeClaude, `#!/bin/sh
echo '{"type":"system","subtype":"init","session_id":"s-1","cwd":"'"$PWD"'"}'
while read -r line; do
  printf '%s\\n' "$line" >> "${sent}"
  case "$line" in *SLOW*) sleep 1;; esac
  case "$line" in *MARK*) sed -i.bak 's/^status: .*/status: review/' "${taskFile}";; esac
  case "$line" in *OVERLOAD*) echo '{"type":"result","result":"API Error: 529 Overloaded.","is_error":true,"api_error_status":529}'; continue;; esac
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

  expect((await call("POST", `${tasks}/delegate`, { repoPath: repo })).error).toBe("the Shuttle starts a Thread only while answering the owner");
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

  // The task page sends a comment without @loom as a comment: recorded, status alone, no Thread.
  writeFileSync(taskFile, readFileSync(taskFile, "utf8").replace(/^status: .*$/m, "status: done"));
  await call("POST", `${tasks}/comments`, { text: "not going to implement this" }, token);
  expect((await call("GET", `/runs/${run.id}`)).status).toBe("done");
  expect(readFileSync(taskFile, "utf8")).toContain("status: done");
  expect(readFileSync(join(data, "projects", p.slug, "tasks", "T-001.log.md"), "utf8")).toContain("| me | comment -->\nnot going to implement this");
}, 30_000);

test("a pin is one line of the document's metadata, counted on the project, and leaves its modified time alone", async () => {
  const { slug } = await call("POST", "/projects", { name: "Pin demo" });
  const md = await call("POST", `/projects/${slug}/artifacts`, { title: "Plan" });
  const html = await call("POST", `/projects/${slug}/artifacts`, { filename: "map.html", content: "<html><head><title>Map</title></head><body></body></html>" });
  for (const a of [md, html]) {
    const on = await call("PATCH", `/projects/${slug}/artifacts/${a.name}`, { pinned: true });
    expect(on).toMatchObject({ pinned: true, title: a.title, modifiedAt: a.modifiedAt });
    const off = await call("PATCH", `/projects/${slug}/artifacts/${a.name}`, { pinned: false });
    expect(off.pinned).toBeUndefined();
    expect(off.content).toBe(a.content);
  }
  const project = (await call("GET", "/state")).projects.find((p: any) => p.slug === slug);
  expect(project).toMatchObject({ artifacts: 2, memory: 0 });
});

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

test("while answering the owner, the Shuttle starts a Thread, signed by it, in the project's directory when it has no codebase", async () => {
  const p = await call("POST", "/projects", { name: "Survey" });
  const t = await call("POST", `/projects/${p.slug}/tasks`, { title: "Survey base models" });
  const shuttle = await call("POST", "/shuttle", { text: "SLOW start a Thread on the survey" });
  await until(shuttle.id, "running");
  const run = await call("POST", `/projects/${p.slug}/tasks/${t.id}/delegate`, { instructions: "survey" });
  expect(run.spec.cwd).toBe(join(data, "projects", p.slug));
  await until(run.id, "done");
  await until(shuttle.id, "done");
  const { timeline } = await call("GET", `/projects/${p.slug}/tasks/${t.id}`);
  expect(timeline.find((e: any) => e.type === "run" && e.detail.startsWith("started"))?.by).toBe("shuttle");
});

test("a Thread that ends wakes the Shuttle, which may start only the follow-on the owner approved", async () => {
  const p = await call("POST", "/projects", { name: "Follow" });
  const tasks = `/projects/${p.slug}/tasks`;
  const first = await call("POST", tasks, { title: "SLOW first" });
  const approved = await call("POST", tasks, { title: "Second", after: first.id });
  const other = await call("POST", tasks, { title: "Third", after: first.id });
  const { token } = (await (await fetch(`${base}/owner`, { headers: { "Sec-Fetch-Site": "same-origin" } })).json()) as any;

  // In a turn the owner began, the Shuttle records the approval; the follow-on does not start yet.
  const asked = await call("POST", "/shuttle", { text: "SLOW start the second when the first ends" });
  await until(asked.id, "running");
  expect((await tool("thread", { action: "approve", project: p.slug, task: approved.id })).text).toBe(`${approved.id} approved to start after ${first.id}`);
  await until(asked.id, "done");

  const thread = await call("POST", `${tasks}/${first.id}/delegate`, {}, token);
  await until(thread.id, "done");
  const shuttle = (await call("GET", "/state")).shuttle;
  expect(shuttle.status).toBe("running");
  expect(readFileSync(join(data, "runs", `${shuttle.id}.jsonl`), "utf8")).toContain("Loom woke you");

  // Woken: no new approval, no start the owner did not approve; the approved one starts.
  expect((await tool("thread", { action: "approve", project: p.slug, task: other.id })).text).toContain("only while answering the owner");
  expect((await tool("thread", { action: "start", project: p.slug, task: other.id })).text).toContain("the owner approved");
  const started = (await tool("thread", { action: "start", project: p.slug, task: approved.id })).text;
  const next = { id: started.split("run ")[1] };
  expect(started).toStartWith(`${approved.id}.1 started`);
  await until(shuttle.id, "done");
  await until(next.id, "done");
  const { timeline } = await call("GET", `${tasks}/${approved.id}`);
  expect(timeline.filter((e: any) => e.type === "run").map((e: any) => [e.by, e.detail.split(" · ")[0]]))
    .toEqual([["shuttle", `approved to start after ${first.id}`], ["shuttle", `started in ${join(data, "projects", p.slug)}`], ["T-002.1", "done"]]);
}, 30_000);

test("without the owner's token, task changes are signed by the Shuttle, and config, automations and deletes are refused", async () => {
  const p = await call("POST", "/projects", { name: "Signed" });
  const t = await call("POST", `/projects/${p.slug}/tasks`, { title: "Draft", comment: "from the call" });
  await call("PATCH", `/projects/${p.slug}/tasks/${t.id}`, { status: "done", comment: "shipped" });
  const { timeline } = await call("GET", `/projects/${p.slug}/tasks/${t.id}`);
  expect(timeline.map((e: any) => e.by)).toEqual(["shuttle", "shuttle", "shuttle", "shuttle"]);
  for (const [method, path] of [["DELETE", `/projects/${p.slug}/tasks/${t.id}`], ["PUT", "/config"], ["POST", "/automations"]])
    expect((await call(method!, path!, {})).error).toBe("only the owner can do that");
});

/** Calls one of the Shuttle's Loom tools over the MCP endpoint, as Claude Code does. */
async function tool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
  const { result } = await call("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  return { text: result.content[0].text, isError: result.isError };
}

test("the Shuttle's tools answer a write with only the id and what changed", async () => {
  const { result } = await call("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" });
  expect(result.tools.map((t: any) => t.name)).toEqual(["task", "memory", "thread", "ingest", "look"]);
  const p = await call("POST", "/projects", { name: "Tools" });
  const body = "## Context\nA long body the answer leaves out.\n\n## Things to do\n- [ ] Book the venue\n";
  expect(await tool("task", { project: p.slug, title: "Plan the party", body })).toEqual({ text: "T-001 created" });
  expect((await tool("task", { project: p.slug, id: "T-001", status: "done", comment: "booked", check: [{ index: 0, checked: true }] })).text)
    .toBe("T-001: status todo -> done; comment written; item 0 ticked");
  expect((await call("GET", `/projects/${p.slug}/tasks/T-001`)).task.body).toContain("- [x] Book the venue");
  expect(await tool("task", { project: p.slug, id: "T-009", status: "done" })).toEqual({ text: "no such task", isError: true });
  expect((await tool("memory", { project: p.slug, name: "organic", description: "Only organic fertiliser.", body: "" })).text).toBe("memory organic.md added");
  expect((await tool("memory", { project: p.slug, name: "organic", description: "Only organic feed.", body: "" })).text).toBe("memory organic.md replaced");
  expect((await tool("memory", { body: "Reply in bullets." })).text).toBe("notebook replaced");
  expect(readFileSync(join(data, "SHUTTLE.md"), "utf8")).toBe("Reply in bullets.\n");
  expect((await tool("memory", { body: "x\n".repeat(41) })).text).toBe("the notebook is at most 40 lines");
  expect((await tool("thread", { action: "start", project: p.slug, task: "T-001", text: "go" })).text).toBe("the Shuttle starts a Thread only while answering the owner");
});

test("a session the API overloads carries on once, in the same run", async () => {
  const id = await say("OVERLOAD now");
  expect((await call("GET", `/runs/${id}`)).status).toBe("done");
  expect(readFileSync(sent, "utf8")).toContain("The API was overloaded; carry on from where you stopped.");
});

test("a run stopped before its result line is priced from its model calls' usage", async () => {
  await stop();
  const id = "20261125215611-hveh";
  const call1 = (output: number) => ({ type: "assistant", message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 0, cache_creation_input_tokens: 100_000, cache_read_input_tokens: 1_000_000, output_tokens: output } } });
  writeFileSync(join(data, "runs", `${id}.json`), JSON.stringify({ id, kind: "shuttle", title: "Stopped", status: "stopped", createdAt: "2026-11-25T21:56:11Z", costUsd: 0, turns: 1, usage: [] }));
  writeFileSync(join(data, "runs", `${id}.jsonl`), [{ type: "dash_prompt", text: "go" }, call1(5), call1(10_000)].map((l) => JSON.stringify(l)).join("\n") + "\n");
  await start();
  // (100K writes x 2 + 1M reads x 0.1) x $4/M + 10K output x $20/M, counting the call's last line once.
  expect((await call("GET", `/runs/${id}`)).costUsd).toBeCloseTo(1.4);
});
