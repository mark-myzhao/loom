import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
