import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as store from "./store";

test("GRAPH.md gives a task's card and every edge that touches it, in both directions", () => {
  store.initStorage();
  const repo = mkdtempSync(join(tmpdir(), "loom-repo-"));
  mkdirSync(join(repo, "docs"));
  writeFileSync(join(repo, "docs", "guide.md"), "# Guide\n\n## Setup\n\nInstall it.\n");
  const { slug } = store.createProject("Graph demo");
  store.addRepo(slug, repo, "app");
  store.createTask(slug, { title: "Plan" });
  store.createTask(slug, {
    title: "Build", parent: "T-001",
    body: "## Context\nWaits on [[T-001]]; follow [[app:docs/guide.md#Setup]] and [[gone.md]]. Not `[[code.md]]`.\n",
  });
  store.appendEvent(slug, "T-001", { by: "me", type: "comment", body: "T-002 should go first · run 20261124120000-abcd" });
  store.writeGraph(slug);

  const graph = readFileSync(join(store.projectDir(slug), "GRAPH.md"), "utf8");
  const lines = graph.split("\n").filter((l) => l.includes("T-002"));
  expect(lines).toContain('T-002  todo  p2  "Build"  no Thread');
  expect(lines).toContain("T-002 | part of | T-001");
  expect(lines).toContain('T-002 | mentions | T-001 | "Waits on [[T-001]]; follow [[app:docs/guide.md#Setup]] and [[gone.md]]. Not `[[code.md]]`."');
  expect(lines.some((l) => l.startsWith("T-001 | mentions | T-002 |"))).toBe(true);

  expect(graph).toContain('app:docs/guide.md  file in app.md  "Guide"');
  expect(graph).toMatch(/T-002 \| mentions \| app:docs\/guide.md#Setup \| "/);
  expect(graph).toMatch(/T-002 \| mentions \| gone.md \| missing \|/);
  expect(graph).not.toContain("| code.md");
  expect(graph).not.toMatch(/\d{14}-[a-z0-9]{4}/);
});

test("a project.json becomes the root task T-000, with its sources and repos as artifacts", () => {
  const dir = join(store.projectsDir(), "legacy");
  mkdirSync(join(dir, "memory"), { recursive: true });
  writeFileSync(join(dir, "project.json"), JSON.stringify({
    name: "Legacy", status: "paused", summary: "Where it stands.", createdAt: "2026-01-05T10:00:00.000Z",
    sources: [{ id: "k3x9ab", kind: "gdoc", url: "https://docs.google.com/d/1", title: "Weekly notes" }],
    repos: [{ name: "app", path: "/tmp" }],
  }));
  writeFileSync(join(dir, "memory", "owner-reviews.md"), "---\nname: owner-reviews\ndescription: The owner reviews.\ntype: decision\nsource: k3x9ab\n---\n");
  store.initStorage();

  expect(existsSync(join(dir, "project.json"))).toBe(false);
  expect(store.readTask("legacy", "T-000")).toMatchObject({ title: "Legacy", status: "todo", created: "2026-01-05" });
  expect(store.readProject("legacy")).toMatchObject({
    name: "Legacy", status: "paused", summary: "Where it stands.",
    sources: [{ id: "k3x9ab", url: "https://docs.google.com/d/1", title: "Weekly notes" }], repos: [{ name: "app", path: "/tmp" }],
  });
  const { nodes, edges } = store.projectGraph("legacy");
  expect(nodes.find((n) => n.address === "k3x9ab.md")?.kind).toBe("link");
  expect(edges).toContainEqual({ from: "owner-reviews", rel: "read from", to: "k3x9ab.md" });
});

test("a task reads as blocked while it waits on a human or a task, and nothing is written", () => {
  const { slug } = store.createProject("States demo");
  const read = (id: string) => {
    const tasks = store.listTasks(slug);
    const log = store.readTimeline(slug, id);
    return store.blockOf(slug, tasks.find((t) => t.id === id)!, tasks, log, store.threadsOf(slug, id, log));
  };
  store.createTask(slug, { title: "Approve" });
  store.createTask(slug, { title: "Ship", after: "T-001, gone/T-009" });
  expect(() => store.patchTask(slug, "T-001", { status: "blocked" }, "me")).toThrow("needs a comment");
  store.patchTask(slug, "T-001", { status: "blocked", comment: "Dana has to approve the API" }, "me");
  expect(read("T-001")).toEqual({ on: "human", state: "blocked", detail: "Dana has to approve the API" });
  expect(read("T-002")).toEqual({ on: "task", state: "blocked", detail: "T-001 (blocked)" });

  // The address that resolves to nothing does not hold; done clears the rest by itself.
  store.patchTask(slug, "T-001", { status: "done" }, "me");
  expect(read("T-002")).toBeUndefined();
  expect(readFileSync(store.taskFile(slug, "T-002"), "utf8")).toContain("after: T-001, gone/T-009");

  store.appendEvent(slug, "T-002", { by: "T-002.1", type: "question", body: "Which region?" });
  expect(read("T-002")).toMatchObject({ on: "human", state: "asks", detail: "Which region?" });
  store.appendEvent(slug, "T-002", { by: "me", type: "note", body: "eu-west" });
  expect(read("T-002")).toBeUndefined();
  store.writeGraph(slug);
  expect(readFileSync(join(store.projectDir(slug), "GRAPH.md"), "utf8")).toContain("T-002 | after | gone/T-009 | missing");
});
