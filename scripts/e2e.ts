// End-to-end tests of the Shuttle: real Claude Code sessions against a throwaway data directory,
// under a token budget. Real tokens are spent, so they run only on demand, never with `bun test`.
//   bun run e2e [case ...] [--budget tokens] [--model id]
// Prints a markdown report: per case, whether the task was done and what it cost.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunMeta } from "../server/types";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
// Every token the model reads or writes counts, cache reads included, so the budget is a hard ceiling on work.
const budget = Number(flag("--budget") ?? 2_000_000);
const model = flag("--model");
const only = args;

const data = mkdtempSync(join(tmpdir(), "loom-e2e-"));
process.env.DASH_DATA_DIR = data;
const store = await import("../server/store");
writeFileSync(join(data, "config.json"), JSON.stringify({ ownerName: "Sam", ...(model ? { shuttleModel: model } : {}) }));

const port = 4900 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}/api`;
const server = Bun.spawn(["bun", join(import.meta.dir, "..", "server", "index.ts")], {
  env: { ...process.env, PORT: String(port), DASH_DATA_DIR: data }, stdout: "ignore", stderr: "inherit",
});
const call = async (method: string, path: string, body?: unknown) =>
  (await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  })).json() as Promise<any>;
for (let i = 0; !(await fetch(`${base}/state`).then((r) => r.ok, () => false)); i++) {
  if (i > 100) throw new Error("the server did not start");
  await Bun.sleep(50);
}

// One project the cases share, seeded before any of them runs.
const { slug } = await call("POST", "/projects", { name: "Garden" });
await call("POST", `/projects/${slug}/tasks`, { title: "Draft the newsletter" });
await call("POST", `/projects/${slug}/tasks`, { title: "Plan the harvest party", body: "## Context\nIn the spring.\n\n## Things to do\n- [ ] Book the venue\n- [ ] Send invites\n" });
await call("POST", `/projects/${slug}/tasks`, { title: "Research compost bins", body: "## Context\nWhich bin suits a small yard.\n" });

const task = (id: string) => store.readTask(slug, id);
const tasksNow = () => JSON.stringify(store.listTasks(slug));
let before = "";

/** Each case is one message in a fresh Shuttle conversation; `check` returns why it failed, or nothing. */
const cases: { name: string; say: string; check: (shuttle: RunMeta, runs: RunMeta[]) => string | undefined | false }[] = [
  {
    name: "create-task", say: "Add a task to Garden: buy tomato seeds, due 2026-12-05.",
    check: () => !store.listTasks(slug).some((t) => /tomato/i.test(t.title) && t.due === "2026-12-05") && "no tomato task due 2026-12-05",
  },
  { name: "set-status", say: "I finished drafting the newsletter.", check: () => task("T-001")?.status !== "done" && `T-001 is ${task("T-001")?.status}` },
  {
    name: "tick-checklist", say: "I booked the venue for the harvest party.",
    check: () => !/- \[x\] Book the venue/.test(task("T-002")?.body ?? "") && "Book the venue is not ticked on T-002",
  },
  {
    name: "add-memory", say: "Remember for Garden: we decided to use only organic fertiliser from now on.",
    check: () => !store.listMemory(slug).some((m) => /organic/i.test(m.description + m.body)) && "no memory entry mentions organic",
  },
  {
    name: "notebook", say: "From now on, keep your replies to me in bullet points.",
    check: () => !/bullet/i.test(store.readText(join(data, "SHUTTLE.md")) ?? "") && "SHUTTLE.md does not mention bullets",
  },
  {
    name: "answer-only", say: "What is open in Garden right now?",
    check: (s) => (tasksNow() !== before && "it changed a task") || (!/compost/i.test(s.result ?? "") && "the reply does not mention the compost task"),
  },
  {
    name: "start-thread", say: "Start a Thread on the compost bins task.",
    check: (_, runs) => !runs.some((r) => r.kind === "task" && r.taskId === "T-003") && "no Thread on T-003",
  },
  {
    name: "file-link", say: "File this link under Garden: https://example.com/soil-guide",
    check: (_, runs) => !runs.some((r) => r.kind === "ingest") && "no ingest run",
  },
].filter((c) => !only.length || only.includes(c.name));

const runFile = (id: string, ext: string) => join(data, "runs", `${id}.${ext}`);
const runIds = () => (existsSync(join(data, "runs")) ? readdirSync(join(data, "runs")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : []);
const meta = (id: string) => JSON.parse(readFileSync(runFile(id, "json"), "utf8")) as RunMeta;
const lines = (id: string) => (readFileSync(runFile(id, "jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const live = (m: RunMeta) => m.status === "queued" || m.status === "running";
const COUNTS = ["input", "output", "cacheRead", "cacheWrite", "costUsd"] as const;
type Used = Record<(typeof COUNTS)[number], number> & { unpriced?: boolean };
const zero = (): Used => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });
function add(to: Used, u: Used) {
  for (const key of COUNTS) to[key] += u[key];
  to.unpriced ||= u.unpriced;
}
/**
 * What a run used. A live or stopped run has no result line, so its record has no usage: count the
 * model calls in its transcript instead, once per message, with no price.
 */
function used(m: RunMeta): Used {
  const u = zero();
  for (const x of m.usage ?? []) add(u, x);
  if (m.usage?.length) return u;
  const calls = new Map<string, any>();
  for (const l of lines(m.id)) if (l.type === "assistant" && l.message?.id) calls.set(l.message.id, l.message.usage ?? {});
  for (const c of calls.values()) {
    u.input += c.input_tokens || 0;
    u.output += c.output_tokens || 0;
    u.cacheRead += c.cache_read_input_tokens || 0;
    u.cacheWrite += c.cache_creation_input_tokens || 0;
  }
  u.unpriced = calls.size > 0;
  return u;
}
const tokens = (u: Used) => u.input + u.output + u.cacheRead + u.cacheWrite;
const money = (u: Used) => `$${u.costUsd.toFixed(2)}${u.unpriced ? " + unpriced" : ""}`;

let spent = 0;
let overBudget = false;
const rows: string[] = [];
const total = zero();
const counts = { turns: 0, tools: 0, errors: 0, seconds: 0, passed: 0 };
const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

for (const c of cases) {
  if (overBudget) {
    rows.push(`| ${c.name} | not run: over budget | | | | | | | | |`);
    continue;
  }
  before = tasksNow();
  const seen = new Set(runIds());
  const started = Date.now();
  const shuttle: RunMeta = await call("POST", "/shuttle", { text: c.say, fresh: true });
  let note = "";
  for (;;) {
    await Bun.sleep(1000);
    const mine = runIds().filter((id) => !seen.has(id)).map(meta);
    // A Thread or ingest run the Shuttle started is the evidence; its work is not under test, so it stops at once.
    for (const m of mine) if (m.kind !== "shuttle" && live(m)) await call("POST", `/runs/${m.id}/stop`, {});
    if (spent + mine.reduce((n, m) => n + tokens(used(m)), 0) > budget) {
      for (const m of mine.filter(live)) await call("POST", `/runs/${m.id}/stop`, {});
      overBudget = true;
      note = "stopped: over budget";
    } else if (Date.now() - started > 5 * 60_000) {
      for (const m of mine.filter(live)) await call("POST", `/runs/${m.id}/stop`, {});
      note = "stopped: over 5 minutes";
    }
    if (!mine.some(live) && mine.length) break;
  }
  const seconds = (Date.now() - started) / 1000;
  const runs = runIds().filter((id) => !seen.has(id)).map(meta);
  const s = runs.find((r) => r.id === shuttle.id)!;
  // Tool calls of the main session, and how many came back as errors (refused or failed commands).
  const transcript = lines(s.id).filter((l) => !l.parent_tool_use_id);
  const blocks = (type: string, role: string) => transcript.filter((l) => l.type === role).flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : [])).filter((b: any) => b.type === type);
  const tools = blocks("tool_use", "assistant").length;
  const errors = blocks("tool_result", "user").filter((b: any) => b.is_error).length;
  const failed = note || (s.status !== "done" ? `Shuttle ${s.status}` : c.check(s, runs) || "");
  const t = zero();
  for (const r of runs) add(t, used(r));
  const all = tokens(t);
  spent += all;
  add(total, t);
  Object.assign(counts, { turns: counts.turns + s.turns, tools: counts.tools + tools, errors: counts.errors + errors, seconds: counts.seconds + seconds, passed: counts.passed + (failed ? 0 : 1) });
  rows.push(`| ${c.name} | ${failed ? `no: ${failed}` : "yes"} | ${s.turns} | ${tools} (${errors}) | ${k(t.input + t.cacheWrite)} | ${k(t.cacheRead)} | ${k(t.output)} | ${k(all)} | ${money(t)} | ${Math.round(seconds)}s |`);
  console.error(`${c.name}: ${failed || "done"} (${k(all)} tokens, ${k(spent)} of ${k(budget)} spent)`);
}

server.kill();
await server.exited;
const allTokens = tokens(total);
console.log(`# Shuttle end-to-end tests, ${new Date().toISOString().slice(0, 16)}Z

Model: ${model || "the CLI default"}. Budget: ${k(budget)} tokens; spent ${k(allTokens)}${overBudget ? ", and the run stopped there" : ""}.
Tokens count the Shuttle and any run it started (stopped at once). Tools: calls (errors). Uncached includes cache writes.

| Case | Done | Turns | Tools | Uncached | Cache read | Output | Tokens | Cost | Time |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join("\n")}
| **${counts.passed} of ${cases.length} done** | | ${counts.turns} | ${counts.tools} (${counts.errors}) | ${k(total.input + total.cacheWrite)} | ${k(total.cacheRead)} | ${k(total.output)} | ${k(allTokens)} | ${money(total)} | ${Math.round(counts.seconds)}s |`);
// A failed run keeps its data directory, so its transcripts can be read.
if (counts.passed === cases.length) rmSync(data, { recursive: true, force: true });
else console.error(`kept ${data} for inspection`);
