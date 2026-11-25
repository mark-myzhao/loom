import { expect, test } from "bun:test";
import { actionOf, pageOf, reviewWaits, type TelemetryEvent } from "./usage";

test("telemetry groups routes and API paths without their ids", () => {
  expect(["#/", "#/usage", "#/p/loom", "#/p/loom/graph", "#/p/loom/t/T-012?run=x"].map(pageOf)).toEqual(["today", "usage", "project tasks", "project graph", "task"]);
  const post = (path: string): TelemetryEvent => ({ t: "", src: "server", ev: "api", method: "POST", path });
  expect(actionOf(post("/api/projects/loom/tasks/T-012/note"))).toBe("POST tasks/*/note");
  expect(actionOf(post("/api/runs/abc/stop"))).toBe("POST runs/*/stop");
});

test("the wait for review ends at the owner's next write to that task, not a task whose id starts the same", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 10, 25, 9, min)).toISOString();
  const ev = [
    { t: at(0), ev: "run.end", kind: "task", project: "loom", taskId: "T-01" },
    { t: at(5), ev: "api", actor: "owner", path: "/api/projects/loom/tasks/T-012/note" },
    { t: at(8), ev: "api", actor: "agent", path: "/api/projects/loom/tasks/T-01" },
    { t: at(20), ev: "api", actor: "owner", path: "/api/projects/loom/tasks/T-01" },
  ].map((e) => ({ src: "server", ...e })) as TelemetryEvent[];
  expect(reviewWaits(ev)).toEqual([20 * 60_000]);
});
