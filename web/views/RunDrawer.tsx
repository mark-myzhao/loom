import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ownerText, type Config, type RunMeta } from "../../server/types";
import { api, enc, isLive, money, onSubmitKey, stamp, useApp } from "../lib";
import { Markdown, RunPill } from "../ui";

type Line = Record<string, any>;

export function Drawer({ title, label, onClose, children, foot }: { title: ReactNode; label?: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode }) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !box.current) return;
      // Tab stays inside the drawer, wrapping at either end.
      const stops = [...box.current.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled), select, textarea, summary")];
      const first = stops[0], last = stops[stops.length - 1];
      const at = document.activeElement;
      if (!first || !last) return;
      if (!box.current.contains(at) || (e.shiftKey ? at === first || at === box.current : at === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  // Focus moves into the drawer and back to where it was; the page behind does not scroll.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    box.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside ref={box} tabIndex={-1} className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
        <header className="drawer-head">
          <div>
            {label && <p className="label">{label}</p>}
            <h2>{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close">Close</button>
        </header>
        <div className="drawer-body">{children}</div>
        {foot && <footer className="drawer-foot">{foot}</footer>}
      </aside>
    </>
  );
}

const short = (s: unknown, n = 110) => {
  const t = typeof s === "string" ? s : JSON.stringify(s) ?? "";
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
function toolSummary(input: any): string {
  if (!input || typeof input !== "object") return "";
  const v = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.url ?? input.query ?? input.description ?? Object.values(input)[0];
  return short(v ?? "");
}
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c?.type === "text" ? c.text : `[${c?.type ?? "content"}]`)).join("\n");
  return content == null ? "" : JSON.stringify(content, null, 2);
}

/** A run's transcript: every line so far, then live lines. Re-subscribes when a follow-up makes the run live again. */
export function useRunLines(id: string | undefined, live: boolean): Line[] {
  const [lines, setLines] = useState<Line[]>([]);
  useEffect(() => {
    setLines([]);
    if (!id) return;
    const buffer: Line[] = [];
    let frame = 0;
    const es = new EventSource(`/api/runs/${enc(id)}/stream`);
    const flush = () => {
      frame = 0;
      const batch = buffer.splice(0);
      setLines((prev) => [...prev, ...batch]);
    };
    es.onmessage = (e) => {
      try {
        buffer.push(JSON.parse(e.data));
      } catch {}
      frame ||= requestAnimationFrame(flush);
    };
    es.addEventListener("end", () => es.close());
    es.onerror = () => es.close();
    return () => {
      es.close();
      cancelAnimationFrame(frame);
    };
  }, [id, live]);
  return lines;
}

/** `chat` shows the opening prompt as the owner's first message, for runs whose instructions live elsewhere. */
export function Transcript({ lines, chat }: { lines: Line[]; chat?: boolean }) {
  // Tool results arrive in later "user" lines; show each one under the call that produced it.
  const results = useMemo(() => {
    const map = new Map<string, { text: string; error: boolean }>();
    for (const l of lines) {
      if (l.type !== "user" || !Array.isArray(l.message?.content)) continue;
      for (const c of l.message.content) if (c?.type === "tool_result") map.set(c.tool_use_id, { text: resultText(c.content), error: !!c.is_error });
    }
    return map;
  }, [lines]);
  const output = useMemo(() => lines.filter((l) => l.type === "dash_output").map((l) => l.text).join("\n"), [lines]);

  return (
    <div className="transcript">
      {lines.map((l, i) => {
        switch (l.type) {
          case "dash_prompt":
          case "dash_user": {
            if (!chat && l.type === "dash_prompt") return <details key={i} className="prompt"><summary className="label">Prompt</summary><pre>{l.text}</pre></details>;
            // In a chat the owner's words are the bubble; what Loom sent with them folds above.
            const text = String(l.text ?? "");
            const own = chat ? ownerText(text) : text;
            return (
              <div key={i} className="owner-msg">
                {own !== text && <details className="prompt"><summary className="label">From Loom</summary><pre>{text.slice(0, -own.length - 5)}</pre></details>}
                <Markdown text={own} />
              </div>
            );
          }
          case "dash_output":
            // A command's output arrives line by line; it is shown as one block where it starts.
            return lines[i - 1]?.type === "dash_output" ? null : <pre key={i} className="output">{output}</pre>;
          case "system":
            return l.subtype === "init" ? <p key={i} className="sysline">session started{l.model ? ` · ${l.model}` : ""}{l.cwd ? ` · ${l.cwd}` : ""}</p> : null;
          case "assistant":
            return (Array.isArray(l.message?.content) ? l.message.content : []).map((c: any, j: number) => {
              if (c?.type === "text" && c.text?.trim()) return <Markdown key={`${i}.${j}`} text={c.text} />;
              if (c?.type !== "tool_use") return null;
              const r = results.get(c.id);
              return (
                <details key={`${i}.${j}`} className={`tool${r?.error ? " tool-error" : ""}`}>
                  <summary><span className="tool-name">{String(c.name).replace(/^mcp__.*?__/, "")}</span> {toolSummary(c.input)}</summary>
                  <pre>{JSON.stringify(c.input, null, 2)}</pre>
                  {r && <pre className={r.error ? "c-bad" : ""}>{r.text.slice(0, 20000) || "(no output)"}</pre>}
                </details>
              );
            });
          case "result":
            return l.is_error ? <p key={i} className="banner bad">{short(l.result ?? "The session ended with an error.", 600)}</p> : null;
          case "dash_end":
            return (
              <div key={i}>
                {l.error && <pre className="banner bad">{l.error}</pre>}
                <p className="sysline">{l.status} · {stamp(l.time)}</p>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

export function RunDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { snap, act } = useApp();
  const [fetched, setFetched] = useState<RunMeta | null>(null);
  const [missing, setMissing] = useState(false);
  const [reply, setReply] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  // The snapshot carries the latest 150 runs; an older one is fetched by id.
  const run = snap.runs.find((r) => r.id === id) ?? (fetched?.id === id ? fetched : null);
  const live = !!run && isLive(run);

  useEffect(() => {
    if (snap.runs.some((r) => r.id === id)) return;
    setMissing(false);
    api<RunMeta>("GET", `/runs/${enc(id)}`).then(setFetched, () => setMissing(true));
  }, [id]);

  const lines = useRunLines(run ? id : undefined, live);

  useEffect(() => {
    if (live) bottom.current?.scrollIntoView({ block: "end" });
  }, [lines.length, live]);

  const send = async () => {
    if (!reply.trim()) return;
    if (await act(() => api("POST", `/runs/${enc(id)}/message`, { text: reply }))) setReply("");
  };

  if (!run) return <Drawer title={missing ? "Run not found" : "Loading…"} onClose={onClose}>{missing && <p className="empty">No run has the id {id}.</p>}</Drawer>;
  return (
    <Drawer
      onClose={onClose}
      title={run.title}
      label={<><RunPill run={run} /> {run.kind} · {stamp(run.createdAt)}{run.costUsd > 0 && ` · ${money(run.costUsd)}`}{run.turns > 0 && ` · ${run.turns} turns`}</>}
      foot={
        live ? (
          <button className="danger" onClick={() => act(() => api("POST", `/runs/${enc(id)}/stop`))}>Stop</button>
        ) : run.sessionId ? (
          <div className="compose">
            <textarea rows={2} value={reply} aria-label="Reply" placeholder="Reply to continue this session…" onChange={(e) => setReply(e.target.value)} onKeyDown={onSubmitKey(send)} />
            <button className="primary" disabled={!reply.trim()} onClick={send}>Send</button>
          </div>
        ) : undefined
      }
    >
      <Transcript lines={lines} chat={run.kind === "shuttle"} />
      {live && <p className="sysline"><span className="pill live run-running">{run.status}</span></p>}
      {run.sessionId && !live && <p className="sysline">Resume in a terminal: <code>cd {run.sessionCwd ?? run.spec.cwd} && claude --resume {run.sessionId}</code></p>}
      <div ref={bottom} />
    </Drawer>
  );
}

/** A list edited as free text (commas or lines), so separators can be typed without being eaten. */
function ListInput({ value, onChange, rows }: { value: string[]; onChange: (v: string[]) => void; rows?: number }) {
  const [text, setText] = useState(value.join(rows ? "\n" : ", "));
  const change = (e: { target: { value: string } }) => {
    setText(e.target.value);
    onChange(e.target.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean));
  };
  return rows ? <textarea rows={rows} spellCheck={false} value={text} onChange={change} /> : <input value={text} onChange={change} />;
}

export function Settings({ onClose }: { onClose: () => void }) {
  const { snap, act, toast } = useApp();
  const [c, setC] = useState<Config>(snap.config);
  const set = (patch: Partial<Config>) => setC({ ...c, ...patch });
  const reader = (patch: Partial<Config["reader"]>) => set({ reader: { ...c.reader, ...patch } });
  const agent = (patch: Partial<Config["agent"]>) => set({ agent: { ...c.agent, ...patch } });
  const save = async () => {
    if (await act(() => api("PUT", "/config", c))) {
      toast("Settings saved.");
      onClose();
    }
  };
  return (
    <Drawer title="Settings" label={<span className="path" title="Data directory">{snap.dataDir}</span>} onClose={onClose} foot={<span className="btn-row end"><button onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save</button></span>}>
      <div className="settings">
        <h3 className="label">You</h3>
        <label>Your name <small>Tells Claude which action items are yours. Empty: looked up through Slack, if a Slack tool is allowed.</small>
          <input value={c.ownerName} onChange={(e) => set({ ownerName: e.target.value })} />
        </label>

        <h3 className="label">Runs</h3>
        <label>Claude executable<input value={c.claudeBin} onChange={(e) => set({ claudeBin: e.target.value })} /></label>
        <label>Runs at once <small>1–8. The rest queue.</small>
          <input type="number" min={1} max={8} value={c.maxConcurrentRuns} onChange={(e) => set({ maxConcurrentRuns: Number(e.target.value) })} />
        </label>

        <h3 className="label">Sessions that read sources</h3>
        <label>Model <small>Empty uses the CLI default.</small><input value={c.reader.model} onChange={(e) => reader({ model: e.target.value })} /></label>
        <label>Permission mode<input value={c.reader.permissionMode} onChange={(e) => reader({ permissionMode: e.target.value })} /></label>
        <label>Allowed tools <small>One per line. Keep these read-only.</small>
          <ListInput rows={6} value={c.reader.allowedTools} onChange={(allowedTools) => reader({ allowedTools })} />
        </label>
        <label>Disallowed tools <small>Keep Bash here: acceptEdits approves read-only shell commands even when Bash is not allowed.</small>
          <ListInput value={c.reader.disallowedTools} onChange={(disallowedTools) => reader({ disallowedTools })} />
        </label>
        <label>How to fetch sources <small>Included in every source-reading prompt.</small>
          <textarea rows={7} value={c.reader.fetchInstructions} onChange={(e) => reader({ fetchInstructions: e.target.value })} />
        </label>
        <label>Connector gateway <small>MCP server whose backends must be enabled once before use. Empty skips that step.</small>
          <input value={c.connectorGateway} onChange={(e) => set({ connectorGateway: e.target.value })} />
        </label>
        <label>Gateway backends<ListInput value={c.connectors} onChange={(connectors) => set({ connectors })} /></label>

        <h3 className="label">Coding agents</h3>
        <label>Model<input value={c.agent.model} onChange={(e) => agent({ model: e.target.value })} /></label>
        <label>Permission mode<input value={c.agent.permissionMode} onChange={(e) => agent({ permissionMode: e.target.value })} /></label>
        <label>Always-allowed tools<ListInput value={c.agent.allowedTools} onChange={(allowedTools) => agent({ allowedTools })} /></label>
        <label className="check"><input type="checkbox" checked={c.agent.useWorktree} onChange={(e) => agent({ useWorktree: e.target.checked })} /> Work in a separate git worktree by default</label>
      </div>
    </Drawer>
  );
}
