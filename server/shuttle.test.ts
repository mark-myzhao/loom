// Runs the real server on a scratch data directory, with a stand-in for the claude binary.

import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const data = mkdtempSync(join(tmpdir(), "loom-test-"));
const port = 4500 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}/api`;
const fakeClaude = join(data, "fake-claude.sh");
writeFileSync(fakeClaude, `#!/bin/sh
cat > /dev/null
echo '{"type":"system","subtype":"init","session_id":"s-1","cwd":"${data}"}'
echo '{"type":"result","result":"Noted.","is_error":false}'
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

const call = async (method: string, path: string, body?: unknown) =>
  (await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json() as Promise<any>;

async function say(text: string): Promise<string> {
  const run = await call("POST", "/shuttle", { text });
  for (let i = 0; i < 100 && (await call("GET", `/runs/${run.id}`)).status !== "done"; i++) await Bun.sleep(50);
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
  expect(prompt).toContain(`T-001 review ${p.slug} "Review the draft"`);
  expect(prompt).toContain("  me: and remind me tomorrow");
  expect(prompt).toContain("  Shuttle: Noted.");
  expect(prompt).toEndWith("\n---\nwhat needs me?");
  expect(readFileSync(join(data, "SESSIONS.md"), "utf8")).toContain(`"file the draft"  wrote nothing`);
}, 30_000);
