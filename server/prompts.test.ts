import { expect, setSystemTime, test } from "bun:test";
import { SHUTTLE_TOOLS, shuttlePrompt } from "./prompts";
import { DEFAULT_CONFIG } from "./store";

test("the Shuttle's system prompt does not change between messages", () => {
  setSystemTime(new Date("2026-11-24T09:00:00Z"));
  const first = shuttlePrompt(DEFAULT_CONFIG);
  setSystemTime(new Date("2026-11-24T17:30:00Z"));
  expect(shuttlePrompt(DEFAULT_CONFIG)).toBe(first);
  setSystemTime();
  expect(first).not.toContain("2026-11-24");
});

test("the Shuttle has a few wide tools and no shell to call routes with", () => {
  expect(SHUTTLE_TOOLS.map((t) => t.name)).toEqual(["task", "memory", "thread", "ingest", "look"]);
  expect(shuttlePrompt(DEFAULT_CONFIG)).not.toMatch(/curl|\/api\//);
});
