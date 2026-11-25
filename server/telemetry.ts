// What the owner and the agents do, one JSON line per action in telemetry/<day>.jsonl. Local only, never
// committed by the snapshot backup, and never the text anyone wrote. Design: docs/design/usage/telemetry.md

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DATA, loadConfig, today } from "./store";
import type { TelemetryEvent } from "./usage";

export const telemetryDir = () => join(DATA, "telemetry");
let writes: Promise<unknown> = Promise.resolve();
let warned = false;

/** Appends events in order; a failed write is dropped and logged once, so it never fails a request. */
export function track(...events: Omit<TelemetryEvent, "t">[]) {
  if (loadConfig().telemetry === false || !events.length) return;
  const t = new Date().toISOString();
  const text = events.map((e) => JSON.stringify({ t, ...e })).join("\n") + "\n";
  writes = writes
    .then(() => mkdir(telemetryDir(), { recursive: true }))
    .then(() => appendFile(join(telemetryDir(), `${today()}.jsonl`), text))
    .catch((e) => warned || (warned = true, console.error("telemetry:", (e as Error).message)));
}

/** Every event of the last `days` local days, oldest first; 0 for all of them. */
export function readTelemetry(days = 0): TelemetryEvent[] {
  if (!existsSync(telemetryDir())) return [];
  const since = days ? new Date(Date.now() - days * 86400000).toISOString() : "";
  return readdirSync(telemetryDir())
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .flatMap((f) => readFileSync(join(telemetryDir(), f), "utf8").split("\n"))
    .flatMap((line) => {
      try {
        return line ? [JSON.parse(line) as TelemetryEvent] : [];
      } catch {
        return []; // A line cut short by a crash.
      }
    })
    .filter((e) => e.t >= since);
}
