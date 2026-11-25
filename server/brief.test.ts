import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { taskPrompt } from "./prompts";
import * as store from "./store";

test("a Thread's brief is its task's neighbourhood: outlines, earlier Threads, memory", () => {
  store.initStorage();
  const p = store.createProject("Brief demo");
  store.createTask(p.slug, { title: "Plan" });
  store.createTask(p.slug, { title: "Build", parent: "T-001", body: "## Context\nFollow [[t-001-plan.md#Steps]].\n" });
  store.createArtifact(p.slug, { title: "Plan", task: "T-001", content: "# Plan\n\n## Goal\n\nShip.\n\n## Steps\n\n1. Build.\n" });
  store.saveMemory(p.slug, undefined, { name: "owner-reviews", description: "The owner reviews every change.", type: "decision" });

  // A first Thread ran and reported.
  const runId = "20261124120000-abcd";
  writeFileSync(join(store.runsDir(), `${runId}.json`), JSON.stringify({ id: runId, status: "done", turns: 12 }));
  store.appendEvent(p.slug, "T-002", { by: "me", type: "run", detail: `started in app · run ${runId}` });
  store.appendEvent(p.slug, "T-002", { by: "agent", type: "comment", body: "## Agent report\nBuilt the parser; tests pass." });

  const tasks = store.listTasks(p.slug);
  const brief = taskPrompt({
    project: p, task: tasks.find((t) => t.id === "T-002")!, worktree: true, ancestors: store.ancestorsOf(tasks, "T-002"), siblings: [],
  });
  expect(brief).toContain('artifacts/t-001-plan.md  "Plan"');
  expect(brief).toMatch(/    Goal  L10-13 /);
  expect(brief).toMatch(/    Steps  L14-17 .*<- the section linked/);
  expect(brief).toContain('T-002.1  done  12 turns  report "Built the parser; tests pass."');
  expect(brief).toContain("(you are T-002.2)");
  expect(brief).toContain("owner-reviews: The owner reviews every change.");
  expect(brief).not.toContain("read them before you start");
  expect(brief).not.toContain(runId);
});

test("a document past about 8,000 tokens is marked Over length in GRAPH.md and the brief", () => {
  const p = store.createProject("Size demo");
  store.createTask(p.slug, { title: "Write" });
  store.createArtifact(p.slug, { title: "Long", task: "T-001", content: `# Long\n\n## Body\n\n${"word ".repeat(7000)}\n` });
  store.writeGraph(p.slug);
  const graph = readFileSync(join(store.projectDir(p.slug), "GRAPH.md"), "utf8");
  expect(graph).toMatch(/t-001-long\.md {2}document {2}"Long" {2}~8\.\dK tokens {2}Over length/);
  const brief = taskPrompt({ project: p, task: store.readTask(p.slug, "T-001")!, worktree: true, ancestors: [], siblings: [] });
  expect(brief).toMatch(/artifacts\/t-001-long\.md {2}"Long" {2}~8\.\dK tokens {2}Over length/);
});

test("the brief points only at markdown: an HTML visual is reached through the document that links it", () => {
  const p = store.createProject("Visual demo");
  store.createTask(p.slug, { title: "Draw" });
  store.createArtifact(p.slug, { filename: "flow.html", task: "T-001", content: '<title>Flow</title><meta name="loom:task" content="T-001"><svg></svg>' });
  store.createArtifact(p.slug, { title: "Flow notes", task: "T-001", content: "# Flow notes\n\n## Summary\n\nThree steps.\n\n[[t-001-flow.html]]\n" });
  const { edges } = store.projectGraph(p.slug);
  expect(edges.some((e) => e.from === "t-001-flow-notes.md" && e.rel === "mentions" && e.to === "t-001-flow.html" && !e.missing)).toBe(true);
  const brief = taskPrompt({ project: p, task: store.readTask(p.slug, "T-001")!, worktree: true, ancestors: [], siblings: [] });
  expect(brief).toContain('artifacts/t-001-flow-notes.md  "Flow notes"');
  expect(brief).not.toContain("artifacts/t-001-flow.html");
});
