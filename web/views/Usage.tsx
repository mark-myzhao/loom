import { useState } from "react";
import {
  actionOf, cachedShare, classOf, CLASSES_OF_ACTIVITY, compact, countBy, dayOf, duration, median, pageOf, promptTokens, reviewWaits, runSpans,
  sumUsage, weekOf, type Count, type TelemetryEvent, type UsageRow, type UsageSum,
} from "../../server/usage";
import { day, money, useApp, useData } from "../lib";

const RANGES = [{ days: 7, label: "7 days" }, { days: 30, label: "30 days" }, { days: 0, label: "All" }];
const STACKS = { kind: "Cost by kind", model: "Cost by model", class: "Tokens by class" };
const CLASSES = [
  { key: "cacheRead", label: "Cache reads" },
  { key: "cacheWrite", label: "Cache writes" },
  { key: "input", label: "Fresh input" },
  { key: "output", label: "Output" },
] as const;
/** The Shuttle's starting context budget, drawn on the context chart. */
const BUDGET = 100_000;

type Dim = "kind" | "task" | "model" | "period";
type Stack = keyof typeof STACKS;
interface Seg { key: string; label: string; value: number; color: string }
type Hover = (body: React.ReactNode) => object;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const series = (i: number) => (i >= 0 && i < 8 ? `var(--viz-${i + 1})` : "var(--ink-3)");
const taskOf = (r: UsageRow) => (r.taskId ? `${r.project} ${r.taskId}` : r.project ?? "No project");

/** Round axis values from zero to the first one at or past `max`: at most seven of them. */
function ticks(max: number): number[] {
  const unit = 10 ** Math.floor(Math.log10(max));
  const step = [0.2, 0.5, 1, 2].map((m) => m * unit).find((s) => max / s <= 5)!;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => Number((i * step).toPrecision(6)));
}

function Tip({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <>
      <p>{title}</p>
      {rows.map((r) => (
        <div key={r.label}>{r.color && <i style={{ background: r.color }} />}<strong>{r.value}</strong><span>{r.label}</span></div>
      ))}
    </>
  );
}
const sumTip = (title: string, s: UsageSum) => (
  <Tip title={title} rows={[
    { label: "cost", value: money(s.costUsd) },
    { label: `run${s.runs === 1 ? "" : "s"}`, value: String(s.runs) },
    { label: "prompt tokens", value: compact(promptTokens(s)) },
    { label: "served from cache", value: pct(cachedShare(s)) },
    { label: "output tokens", value: compact(s.output) },
  ]} />
);

/** Bars over time. Each bar is one day or week, stacked; clicking one narrows the page to it. */
function Timeline({ bars, format, picked, onPick, hover }: {
  bars: { key: string; label: string; segs: Seg[] }[]; format: (n: number) => string; picked?: string; onPick: (key: string) => void; hover: Hover;
}) {
  const total = (segs: Seg[]) => segs.reduce((sum, s) => sum + s.value, 0);
  const top = Math.max(...bars.map((b) => total(b.segs)), 1e-9);
  return (
    <div className="viz-timeline">
      {bars.map((b) => (
        <button
          key={b.key} data-track="usage bar" className={picked && picked !== b.key ? "dim" : ""} onClick={() => onPick(b.key)}
          {...hover(<Tip title={b.label} rows={[...b.segs].reverse().map((s) => ({ label: s.label, value: format(s.value), color: s.color }))} />)}
        >
          <span>{format(total(b.segs))}</span>
          <div style={{ height: `${Math.max(3, (total(b.segs) / top) * 180)}px` }}>
            {/* A sliver under half a percent would be all gap; the tooltip still lists it. */}
            {[...b.segs].reverse().map((s) => s.value > total(b.segs) / 200 && <i key={s.key} style={{ flexGrow: s.value, background: s.color }} />)}
          </div>
          <small>{b.label}</small>
        </button>
      ))}
    </div>
  );
}

/** One row per key, longest first. Clicking a row narrows the page to it. */
function Breakdown({ title, sums, picked, onPick, colorOf, hover }: {
  title: string; sums: UsageSum[]; picked?: string; onPick: (key: string) => void; colorOf: (key: string) => string; hover: Hover;
}) {
  const top = Math.max(...sums.map((s) => s.costUsd), 1e-9);
  return (
    <section>
      <p className="label">{title}</p>
      {sums.map((s) => (
        <button key={s.key} data-track="usage row" className={`viz-row${picked && picked !== s.key ? " dim" : ""}`} aria-pressed={picked === s.key} onClick={() => onPick(s.key)} {...hover(sumTip(s.key, s))}>
          <span>{s.key}</span>
          <b><i style={{ width: `${Math.max(1, (s.costUsd / top) * 100)}%`, background: colorOf(s.key) }} /></b>
          <em>{money(s.costUsd)}</em>
        </button>
      ))}
    </section>
  );
}

/** A dot per run: how full its context got against what it cost. */
function ContextChart({ runs, hover, onOpen }: { runs: (UsageSum & { row: UsageRow })[]; hover: Hover; onOpen: (run: string) => void }) {
  const W = 560, H = 250, L = 46, B = 26, T = 14, R = 14;
  const xs = ticks(Math.max(...runs.map((r) => r.row.peakContext ?? 0), BUDGET * 1.2));
  const ys = ticks(Math.max(...runs.map((r) => r.costUsd), 0.01));
  const x = (v: number) => L + (v / xs.at(-1)!) * (W - L - R);
  const y = (v: number) => H - B - (v / ys.at(-1)!) * (H - B - T);
  return (
    <svg className="viz-scatter" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Peak context against cost, one dot per run">
      {ys.map((v) => (
        <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v ? "grid" : "axis"} /><text x={L - 6} y={y(v) + 4} textAnchor="end">{`$${v}`}</text></g>
      ))}
      {xs.map((v) => <text key={v} x={x(v)} y={H - 8} textAnchor="middle">{compact(v)}</text>)}
      <line x1={x(BUDGET)} x2={x(BUDGET)} y1={T} y2={H - B} className="mark" />
      <text x={x(BUDGET) + 5} y={T + 8}>budget {compact(BUDGET)}</text>
      {runs.map((r) => (
        <g key={r.key} data-track="usage dot" tabIndex={0} role="button" onClick={() => onOpen(r.key)} onKeyDown={(e) => e.key === "Enter" && onOpen(r.key)}
          {...hover(<Tip title={r.row.title} rows={[
            { label: "cost", value: money(r.costUsd) }, { label: "peak context", value: compact(r.row.peakContext ?? 0) },
            { label: "turns", value: String(r.row.turns) }, { label: "served from cache", value: pct(cachedShare(r)) }, { label: "kind", value: r.row.kind },
          ]} />)}>
          <circle cx={x(r.row.peakContext ?? 0)} cy={y(r.costUsd)} r={12} fill="transparent" />
          <circle cx={x(r.row.peakContext ?? 0)} cy={y(r.costUsd)} r={5} className="dot" />
        </g>
      ))}
    </svg>
  );
}

function Numbers({ head, sums }: { head: string; sums: UsageSum[] }) {
  return (
    <table className="usage-table">
      <thead>
        <tr><th>{head}</th><th>Runs</th><th>Prompt</th><th>Cached</th><th>Cache writes</th><th>Output</th><th>Cost</th></tr>
      </thead>
      <tbody>
        {sums.map((s) => (
          <tr key={s.key}>
            <td>{s.key}</td><td>{s.runs}</td><td>{compact(promptTokens(s))}</td><td>{pct(cachedShare(s))}</td>
            <td>{compact(s.cacheWrite)}</td><td>{compact(s.output)}</td><td>{money(s.costUsd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One row per key, most first; `split` shows the owner's share apart from the agents'. */
function Counts({ title, counts, note, split }: { title: string; counts: Count[]; note?: (c: Count) => string; split?: boolean }) {
  const top = Math.max(...counts.map((c) => c.n), 1);
  return (
    <section>
      <p className="label">
        {title}
        {split && <span className="viz-legend"><span><i style={{ background: series(0) }} />owner</span><span><i style={{ background: series(1) }} />agent</span></span>}
      </p>
      {counts.slice(0, 12).map((c) => (
        <div key={c.key} className="viz-row">
          <span title={c.key}>{c.key}</span>
          <b style={{ width: `${Math.max(2, (c.n / top) * 100)}%` }}>
            {split ? [c.owner, c.n - c.owner].map((v, i) => v > 0 && <i key={i} style={{ flexGrow: v, background: series(i) }} />) : <i style={{ flexGrow: 1, background: series(0) }} />}
          </b>
          <em>{note ? note(c) : c.n}</em>
        </div>
      ))}
      {!counts.length && <p className="muted">None in this range.</p>}
    </section>
  );
}

/** What the owner and the agents did: the telemetry log, in the same range and period as the usage above. */
function Activity({ events, periodOf, periodLabel, picked, onPick, hover }: {
  events: TelemetryEvent[]; periodOf: (iso: string) => string; periodLabel: (key: string) => string; picked?: string; onPick: (key: string) => void; hover: Hover;
}) {
  const ev = events.filter((e) => !picked || periodOf(e.t) === picked);
  const views = ev.filter((e) => e.ev === "view");
  const writes = ev.filter((e) => e.ev === "api");
  const spans = runSpans(ev);
  const waits = reviewWaits(ev);
  const owned = writes.filter((e) => e.actor === "owner").length;
  const bars = countBy(events.filter(classOf), (e) => periodOf(e.t)).sort((a, b) => a.key.localeCompare(b.key)).map((p) => {
    const mine = events.filter((e) => periodOf(e.t) === p.key);
    const segs = CLASSES_OF_ACTIVITY.map((c, i) => ({ key: c, label: c, value: mine.filter((e) => classOf(e) === c).length, color: series(i) }));
    return { key: p.key, label: periodLabel(p.key), segs };
  });
  const msOn = (page: string) => median(views.filter((e) => e.from && pageOf(e.from) === page).map((e) => e.ms));
  const msOf = (key: string) => median(spans.filter((e) => `${e.kind} ${e.status}` === key).map((e) => e.ms));

  return (
    <>
      <header className="activity-head">
        <div><p className="label">What the owner and the agents did, from the local telemetry log</p><h2>Activity</h2></div>
      </header>
      {!events.length ? (
        <p className="empty">Nothing logged in this range. Views, clicks, writes and runs are logged from now on, unless telemetry is off in config.json.</p>
      ) : (
        <>
          <div className="usage-tiles">
            <div><p className="label">Page views</p><strong>{views.length}</strong><span>{new Set(views.map((e) => e.tab)).size} visits</span></div>
            <div><p className="label">Clicks</p><strong>{ev.filter((e) => e.ev === "click").length}</strong><span>buttons and links</span></div>
            <div>
              <p className="label">Writes by the owner</p><strong>{writes.length ? pct(owned / writes.length) : "–"}</strong>
              <span>{owned} of {writes.length}; the rest by agents</span>
            </div>
            <div><p className="label">Wait for review</p><strong>{waits.length ? duration(median(waits)) : "–"}</strong><span>median, {waits.length} finished Thread{waits.length === 1 ? "" : "s"}</span></div>
          </div>
          <section>
            <p className="label">
              Over time
              <span className="viz-legend">{CLASSES_OF_ACTIVITY.map((c, i) => <span key={c}><i style={{ background: series(i) }} />{c}</span>)}</span>
            </p>
            <Timeline bars={bars} format={String} picked={picked} onPick={onPick} hover={hover} />
          </section>
          <div className="viz-cols">
            <Counts title="Pages viewed · median time on page" counts={countBy(views, (e) => pageOf(e.route))} note={(c) => `${c.n} · ${duration(msOn(c.key))}`} />
            <Counts title="Clicked most" counts={countBy(ev.filter((e) => e.ev === "click"), (e) => e.label)} />
            <Counts title="Writes by action" counts={countBy(writes, actionOf)} split />
            <Counts title="Runs by kind and status · median length" counts={countBy(spans, (e) => `${e.kind} ${e.status}`)} note={(c) => `${c.n} · ${duration(msOf(c.key))}`} />
          </div>
        </>
      )}
    </>
  );
}

export function Usage() {
  const { openRun } = useApp();
  const { data, error } = useData<UsageRow[]>("/usage");
  // A telemetry log that cannot be read leaves the token charts as they are.
  const { data: events, error: noEvents } = useData<TelemetryEvent[]>("/telemetry");
  const [days, setDays] = useState(7);
  const [weekly, setWeekly] = useState(false);
  const [stack, setStack] = useState<Stack>("kind");
  const [picked, setPicked] = useState<Partial<Record<Dim, string>>>({});
  const [tip, setTip] = useState<{ x: number; y: number; body: React.ReactNode } | null>(null);
  if (error) return <div className="page"><p className="empty">{error}</p></div>;
  if (!data || (!events && !noEvents)) return <div className="page" />;

  const keyOf: Record<Dim, (r: UsageRow) => string> = {
    kind: (r) => r.kind, task: taskOf, model: (r) => r.model, period: (r) => (weekly ? weekOf(r.at) : dayOf(r.at)),
  };
  const since = days ? new Date(Date.now() - days * 86400000).toISOString() : "";
  const inRange = data.filter((r) => r.at >= since);
  /** The rows every chart draws, optionally ignoring one filter so that chart keeps its other marks. */
  const slice = (except?: Dim) => inRange.filter((r) => (Object.keys(picked) as Dim[]).every((d) => d === except || keyOf[d](r) === picked[d]));
  const pick = (dim: Dim) => (key: string) => setPicked(({ [dim]: was, ...rest }) => (was === key ? rest : { ...rest, [dim]: key }));
  // A colour belongs to a key for good: it comes from every key ever seen, not from what is filtered in.
  const colorOf = (dim: Dim) => {
    const keys = [...new Set(data.map(keyOf[dim]))].sort();
    return (key: string) => series(keys.indexOf(key));
  };
  const hover: Hover = (body) => ({
    onPointerMove: (e: React.PointerEvent) => setTip({ x: e.clientX, y: e.clientY, body }),
    onPointerLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent) => {
      const box = e.currentTarget.getBoundingClientRect();
      setTip({ x: box.left + box.width / 2, y: box.top, body });
    },
    onBlur: () => setTip(null),
  });

  const rows = slice();
  const total = sumUsage(rows, () => "all")[0];
  const byCost = (dim: Dim, from = rows) => sumUsage(from, keyOf[dim]).sort((a, b) => b.costUsd - a.costUsd);
  const periodLabel = (key: string) => (weekly ? `week of ${day(key)}` : day(key));
  const bars = sumUsage(slice("period"), keyOf.period).sort((a, b) => a.key.localeCompare(b.key)).map((p) => {
    const mine = slice("period").filter((r) => keyOf.period(r) === p.key);
    const segs: Seg[] = stack === "class"
      ? CLASSES.map((c, i) => ({ key: c.key, label: c.label, value: p[c.key], color: series(i) }))
      : byCost(stack, mine).map((s) => ({ key: s.key, label: s.key, value: s.costUsd, color: colorOf(stack)(s.key) }));
    return { key: p.key, label: periodLabel(p.key), segs };
  });
  const legend = stack === "class" ? CLASSES.map((c, i) => ({ label: c.label, color: series(i) }))
    : byCost(stack, slice("period")).map((s) => ({ label: s.key, color: colorOf(stack)(s.key) }));
  const rowOf = new Map(rows.map((r) => [r.run, r]));
  const runs = sumUsage(rows, (r) => r.run).sort((a, b) => b.costUsd - a.costUsd).map((s) => ({ ...s, row: rowOf.get(s.key)! }));
  const topPrompt = Math.max(...runs.map(promptTokens), 1);
  // Peak context is a run's whole life, so the dot is placed by its whole cost, not the part inside the range.
  const life = new Map(sumUsage(data, (r) => r.run).map((s) => [s.key, s]));

  return (
    <div className="page usage">
      <header className="page-head">
        <div>
          <p className="label">Tokens and cost of every run</p>
          <h1>Usage</h1>
        </div>
      </header>
      <div className="viz-filters">
        {RANGES.map((r) => <button key={r.days} className="viz-chip" aria-pressed={days === r.days} onClick={() => setDays(r.days)}>{r.label}</button>)}
        <span className="sep" />
        {[false, true].map((w) => (
          <button key={String(w)} className="viz-chip" aria-pressed={weekly === w} onClick={() => (setWeekly(w), setPicked(({ period: _, ...rest }) => rest))}>{w ? "Weeks" : "Days"}</button>
        ))}
        <span className="sep" />
        {(Object.keys(picked) as Dim[]).map((d) => (
          <button key={d} data-track="usage filter" className="viz-chip on" title="Remove this filter" onClick={() => pick(d)(picked[d]!)}>{d === "period" ? periodLabel(picked[d]!) : picked[d]} ✕</button>
        ))}
        {!Object.keys(picked).length && <span className="muted">Click a bar or a row to narrow everything to it.</span>}
      </div>
      {!total ? (
        <p className="empty">No usage here. Runs made before usage was tracked are filled in when the server next starts.</p>
      ) : (
        <>
          <div className="usage-tiles">
            <div><p className="label">Cost</p><strong>{money(total.costUsd)}</strong><span>{total.runs} run{total.runs === 1 ? "" : "s"} · {money(total.costUsd / total.runs)} each</span></div>
            <div><p className="label">Prompt tokens</p><strong>{compact(promptTokens(total))}</strong><span>{compact(total.cacheWrite)} written to cache</span></div>
            <div>
              <p className="label">Served from cache</p><strong>{pct(cachedShare(total))}</strong>
              <b className="viz-meter"><i style={{ width: pct(cachedShare(total)) }} /></b>
            </div>
            <div><p className="label">Output tokens</p><strong>{compact(total.output)}</strong><span>thinking included</span></div>
          </div>

          <section>
            <p className="label">
              Over time
              <span className="viz-legend">{legend.map((l) => <span key={l.label}><i style={{ background: l.color }} />{l.label}</span>)}</span>
              <span className="btn-row">
                {(Object.keys(STACKS) as Stack[]).map((s) => <button key={s} className="viz-chip" aria-pressed={stack === s} onClick={() => setStack(s)}>{STACKS[s]}</button>)}
              </span>
            </p>
            <Timeline bars={bars} format={stack === "class" ? compact : money} picked={picked.period} onPick={pick("period")} hover={hover} />
          </section>

          <div className="viz-cols three">
            <Breakdown title="By kind of run" sums={byCost("kind", slice("kind"))} picked={picked.kind} onPick={pick("kind")} colorOf={stack === "kind" ? colorOf("kind") : () => series(0)} hover={hover} />
            <Breakdown title="By task" sums={byCost("task", slice("task"))} picked={picked.task} onPick={pick("task")} colorOf={() => series(0)} hover={hover} />
            <Breakdown title="By model" sums={byCost("model", slice("model"))} picked={picked.model} onPick={pick("model")} colorOf={stack === "model" ? colorOf("model") : () => series(0)} hover={hover} />
          </div>

          <div className="viz-cols">
            <section>
              <p className="label">Context against cost<span className="label-hint">a run, whole life · click to open</span></p>
              <ContextChart runs={runs.map((r) => ({ ...life.get(r.key)!, row: r.row }))} hover={hover} onOpen={openRun} />
            </section>
            <section>
              <p className="label">
                What the costliest runs sent
                <span className="viz-legend">{CLASSES.slice(0, 3).map((c, i) => <span key={c.key}><i style={{ background: series(i) }} />{c.label}</span>)}</span>
              </p>
              {runs.slice(0, 8).map((r) => (
                <button key={r.key} data-track="usage run" className="viz-row runs" onClick={() => openRun(r.key)} {...hover(sumTip(r.row.title, r))}>
                  <span>{r.row.title}</span>
                  <b style={{ width: `${Math.max(2, (promptTokens(r) / topPrompt) * 100)}%` }}>
                    {CLASSES.slice(0, 3).map((c, i) => r[c.key] > 0 && <i key={c.key} style={{ flexGrow: r[c.key], background: series(i) }} />)}
                  </b>
                  <em>{compact(promptTokens(r))} · {money(r.costUsd)}</em>
                </button>
              ))}
            </section>
          </div>

          <details className="viz-numbers">
            <summary className="label">The numbers</summary>
            <Numbers head="Kind" sums={byCost("kind")} />
            <Numbers head="Task" sums={byCost("task")} />
            <Numbers head="Model" sums={byCost("model")} />
            <Numbers head={weekly ? "Week from" : "Day"} sums={sumUsage(rows, keyOf.period).sort((a, b) => a.key.localeCompare(b.key))} />
          </details>
        </>
      )}
      <Activity
        events={(events ?? []).filter((e) => e.t >= since)} periodOf={(t) => (weekly ? weekOf(t) : dayOf(t))}
        periodLabel={periodLabel} picked={picked.period} onPick={pick("period")} hover={hover}
      />
      {tip && <div className="viz-tip" style={{ left: Math.min(tip.x + 14, innerWidth - 250), top: tip.y + 14 }}>{tip.body}</div>}
    </div>
  );
}
