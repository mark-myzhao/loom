import { expect, setSystemTime, test } from "bun:test";
import { SHUTTLE_ROUTES, shuttlePrompt } from "./prompts";
import { DEFAULT_CONFIG } from "./store";

test("the Shuttle's system prompt does not change between messages", () => {
  setSystemTime(new Date("2026-11-24T09:00:00Z"));
  const first = shuttlePrompt(DEFAULT_CONFIG, "http://127.0.0.1:4400");
  setSystemTime(new Date("2026-11-24T17:30:00Z"));
  expect(shuttlePrompt(DEFAULT_CONFIG, "http://127.0.0.1:4400")).toBe(first);
  setSystemTime();
  expect(first).not.toContain("2026-11-24");
});

test("the Shuttle may call no config, automation, delegate or state route", () => {
  for (const [, , path] of SHUTTLE_ROUTES) expect(path).not.toMatch(/config|automations|delegate|\/api\/state/);
  const prompt = shuttlePrompt(DEFAULT_CONFIG, "http://127.0.0.1:4400");
  expect(prompt).not.toMatch(/\/delegate|\/automations|\/api\/state/);
});
