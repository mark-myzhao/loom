// Prints a token-usage report in markdown, for a daily or weekly retro.
//   bun run usage [days]     default 7; 0 for everything
// Reads the run records directly, so it works whether or not the server is up.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runsDir } from "../server/store";
import type { RunMeta } from "../server/types";
import { cachedShare, compact, dayOf, promptTokens, sumUsage, usageRows, weekOf, type UsageRow, type UsageSum } from "../server/usage";

const days = Number(process.argv[2] ?? 7);
const since = days ? new Date(Date.now() - days * 86400000).toISOString() : "";
const runs = readdirSync(runsDir())
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(runsDir(), f), "utf8")) as RunMeta);
const rows = usageRows(runs).filter((r) => r.at >= since);

function table(title: string, sums: UsageSum[]) {
  console.log(`\n## ${title}\n\n| | Runs | Prompt | Cached | Cache writes | Output | Cost |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const s of sums)
    console.log(`| ${s.key} | ${s.runs} | ${compact(promptTokens(s))} | ${Math.round(cachedShare(s) * 100)}% | ${compact(s.cacheWrite)} | ${compact(s.output)} | $${s.costUsd.toFixed(2)} |`);
}
const byCost = (keyOf: (r: UsageRow) => string) => sumUsage(rows, keyOf).sort((a, b) => b.costUsd - a.costUsd);
const byDate = (keyOf: (r: UsageRow) => string) => sumUsage(rows, keyOf).sort((a, b) => a.key.localeCompare(b.key));

console.log(`# Loom usage, ${days ? `last ${days} days` : "all time"}`);
if (!rows.length) console.log("\nNo usage recorded. Runs made before usage tracking are filled in when the server next starts.");
else {
  table("Total", sumUsage(rows, () => "All"));
  table("By day", byDate((r) => dayOf(r.at)));
  if (days === 0 || days > 14) table("By week, from Monday", byDate((r) => weekOf(r.at)));
  table("By kind", byCost((r) => r.kind));
  table("By task", byCost((r) => (r.taskId ? `${r.project} ${r.taskId}` : r.project ?? "(no project)")));
  table("By model", byCost((r) => r.model));
  const first = new Map(rows.map((r) => [r.run, r]));
  table("Costliest runs", byCost((r) => r.run).slice(0, 10).map((s) => {
    const r = first.get(s.key)!;
    return { ...s, key: `${r.title.slice(0, 60)} (${r.kind}, ${r.turns} turns, peak context ${compact(r.peakContext ?? 0)})` };
  }));
}
