import { useState } from "react";
import type { Automation, RunMeta } from "../../server/types";
import { api, enc, onSubmitKey, useApp } from "../lib";
import { Select } from "../controls";
import { Empty, RunPill } from "../ui";
import { Drawer } from "./RunDrawer";

const BLANK: Automation = { id: "", name: "", kind: "command", run: "", time: "", enabled: true };

function Editor({ automation, onClose }: { automation: Automation; onClose: () => void }) {
  const { snap, act } = useApp();
  const [a, setA] = useState(automation);
  const set = (patch: Partial<Automation>) => setA({ ...a, ...patch });
  const save = async () => {
    if (await act(() => (a.id ? api("PUT", `/automations/${enc(a.id)}`, a) : api("POST", "/automations", a)))) onClose();
  };
  const remove = async () => {
    if (confirm(`Delete “${a.name}”?`) && (await act(() => api("DELETE", `/automations/${enc(a.id)}`)))) onClose();
  };
  return (
    <Drawer
      title={a.id ? "Edit automation" : "New automation"} onClose={onClose}
      foot={
        <span className="btn-row end">
          {a.id && <button className="danger" onClick={remove}>Delete</button>}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!a.name.trim() || !a.run.trim()} onClick={save}>Save</button>
        </span>
      }
    >
      <div className="settings">
        <label>Name<input autoFocus value={a.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label>What it runs
          <Select value={a.kind} onChange={(kind) => set({ kind: kind as Automation["kind"] })} options={[{ value: "command", label: "A shell command" }, { value: "claude", label: "A Claude session" }]} />
        </label>
        {a.kind === "command" ? (
          <label>Command <small>Run with sh. It can do anything you can do in a terminal.</small>
            <textarea rows={5} spellCheck={false} value={a.run} onChange={(e) => set({ run: e.target.value })} onKeyDown={onSubmitKey(save)} />
          </label>
        ) : (
          <label>Prompt <small>A headless session with the tools allowed under “Sessions that read sources” in Settings: it can read sources and edit Loom’s files, with no shell.</small>
            <textarea rows={8} value={a.run} onChange={(e) => set({ run: e.target.value })} onKeyDown={onSubmitKey(save)} />
          </label>
        )}
        <label>Runs in <small>The working directory: one project’s folder, or the whole data directory.</small>
          <Select value={a.project ?? ""} onChange={(project) => set({ project: project || undefined })} options={[{ value: "", label: snap.dataDir }, ...snap.projects.map((p) => ({ value: p.slug, label: p.name }))]} />
        </label>
        <label>Every day at (local time) <small>Empty: only when you press Run.</small>
          <input type="time" value={a.time} onChange={(e) => set({ time: e.target.value })} />
        </label>
        <label className="check"><input type="checkbox" checked={a.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Run on schedule</label>
      </div>
    </Drawer>
  );
}

export function Automations() {
  const { snap, act, openRun } = useApp();
  const [editing, setEditing] = useState<Automation | null>(null);
  const run = async (a: Automation) => {
    const started = await act(() => api<RunMeta>("POST", `/automations/${enc(a.id)}/run`));
    if (started) openRun(started.id);
  };
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="label">Commands and Claude sessions you set up</p>
          <h1>Automations</h1>
        </div>
        <button className="primary" onClick={() => setEditing(BLANK)}>New automation</button>
      </header>
      {!snap.automations.length && <Empty>No automations. Set one up to run a shell command or a Claude prompt on demand, or every day at a time you choose.</Empty>}
      {snap.automations.map((a) => {
        const last = snap.runs.find((r) => r.kind === "automation" && r.title === a.name);
        const project = snap.projects.find((p) => p.slug === a.project);
        return (
          <div key={a.id} className="row">
            <span className="tag">{a.kind}</span>
            <button className="link row-title" title={a.run} onClick={() => setEditing(a)}>{a.name}</button>
            <span className="row-meta">
              {a.project && <span className="tag">{project?.name ?? a.project}</span>}
              <span>{!a.time ? "on demand" : a.enabled ? `daily at ${a.time}` : `paused (${a.time})`}</span>
              {last && <button className="link" title="Open the latest run" onClick={() => openRun(last.id)}><RunPill run={last} /></button>}
              <button onClick={() => run(a)}>Run</button>
            </span>
          </div>
        );
      })}
      {editing && <Editor key={editing.id} automation={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
