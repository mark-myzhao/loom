// Prints what the owner and the agents did, from the telemetry log, in markdown for a retro.
//   bun run telemetry [days]     default 7; 0 for everything
// Reads the log files directly, so it works whether or not the server is up.

import { readTelemetry } from "../server/telemetry";
import { actionOf, countBy, duration, median, pageOf, reviewWaits, runSpans, type Count } from "../server/usage";

const days = Number(process.argv[2] ?? 7);
const ev = readTelemetry(days);

function table(title: string, head: string, counts: Count[], extra?: [string, (c: Count) => string]) {
  console.log(`\n## ${title}\n\n| ${head} | Count |${extra ? ` ${extra[0]} |` : ""}\n| --- | ---: |${extra ? " ---: |" : ""}`);
  for (const c of counts) console.log(`| ${c.key} | ${c.n} |${extra ? ` ${extra[1](c)} |` : ""}`);
}

console.log(`# Loom activity, ${days ? `last ${days} days` : "all time"}`);
if (!ev.length) console.log("\nNothing logged. Telemetry starts with the server, unless `telemetry` is false in config.json.");
else {
  const views = ev.filter((e) => e.ev === "view");
  const spans = runSpans(ev);
  const waits = reviewWaits(ev);
  table("Pages viewed", "Page", countBy(views, (e) => pageOf(e.route)),
    ["Median time", (c) => duration(median(views.filter((e) => e.from && pageOf(e.from) === c.key).map((e) => e.ms)))]);
  table("Clicked most", "Label", countBy(ev.filter((e) => e.ev === "click"), (e) => e.label).slice(0, 20));
  table("Writes", "Action", countBy(ev.filter((e) => e.ev === "api"), actionOf), ["By the owner", (c) => String(c.owner)]);
  table("Runs", "Kind and status", countBy(spans, (e) => `${e.kind} ${e.status}`),
    ["Median length", (c) => duration(median(spans.filter((e) => `${e.kind} ${e.status}` === c.key).map((e) => e.ms)))]);
  console.log(`\n## Wait for review\n\n${waits.length ? `Median ${duration(median(waits))} from a Thread's finish to the owner's next write to its task, over ${waits.length} finishes.` : "No finished Thread was followed by a write from the owner."}`);
}
