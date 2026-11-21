import { useEffect, useState } from "react";
import type { ArtifactDetail, ProjectSnapshot } from "../../server/types";
import { ago, api, enc, go, hashWith, onSubmitKey, taskHref, useApp, useData } from "../lib";
import { KindBadge, Markdown } from "../ui";

/** The markdown body without its frontmatter block. */
function stripFrontmatter(text: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

export function DocPage({ project: p, name, edit }: { project: ProjectSnapshot; name: string; edit: boolean }) {
  const { act } = useApp();
  const base = `/projects/${enc(p.slug)}/artifacts/${enc(name)}`;
  const { data, error, reload } = useData<ArtifactDetail>(base);
  const [draft, setDraft] = useState<string | null>(null);
  const back = `#/p/${enc(p.slug)}/artifacts`;

  useEffect(() => setDraft(null), [p.slug, name, edit]);
  useEffect(() => {
    if (edit && data && draft === null) setDraft(data.content);
  }, [edit, !!data]);
  // An HTML artifact can save a new version of itself. Only this document's own
  // frame is heard, so a page can rewrite nothing but its own file.
  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const frame = document.querySelector<HTMLIFrameElement>(".doc-frame");
      if (!frame || e.source !== frame.contentWindow || typeof e.data?.loomSave !== "string") return;
      if (await act(() => api("PUT", base, { content: e.data.loomSave }))) reload();
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [base]);

  if (error) return <div className="page"><p className="banner bad">{error}</p><a href={back}>← Documents</a></div>;
  if (!data) return <div className="page" />;
  const leave = () => go(hashWith("edit", null));
  const save = async () => {
    if (draft === null) return;
    if (draft === data.content || (await act(() => api("PUT", base, { content: draft })))) {
      reload();
      leave();
    }
  };
  const remove = async () => {
    if (!confirm(`Delete “${data.title}”? It moves to the trash.`)) return;
    if (await act(() => api("DELETE", base))) go(back);
  };
  return (
    <div className="page">
      <p className="label crumbs">
        <a href={`#/p/${enc(p.slug)}`}>{p.name}</a> / <a href={back}>Documents</a>
        {data.task && <> / <a href={taskHref(p.slug, data.task)}>{data.task}</a></>}
      </p>
      <header className="doc-head">
        <div>
          <h1 className="doc-title">{data.title}</h1>
          <p className="label">
            <KindBadge kind={data.kind} /> {name}
            {data.origin && ` · ${data.origin}`}
            {data.source && <> · {/^https?:/.test(data.source) ? <a href={data.source} target="_blank" rel="noopener noreferrer">source</a> : data.source}</>}
            {" "}· edited {ago(data.modifiedAt)}
          </p>
        </div>
        <span className="btn-row">
          {edit ? (
            <>
              <button onClick={leave}>Cancel</button>
              <button className="primary" onClick={save}>Save</button>
            </>
          ) : (
            <>
              {data.kind === "md" && <button onClick={() => go(hashWith("edit", ""))}>Edit source</button>}
              {data.kind === "html" && <a className="button" href={`/api${base}/raw`} target="_blank" rel="noopener noreferrer">Open page</a>}
              <a className="button" href={`/api${base}/raw?view=source`} target="_blank" rel="noopener noreferrer">Raw</a>
              <button className="danger" onClick={remove}>Delete</button>
            </>
          )}
        </span>
      </header>

      {edit ? (
        <textarea className="source-edit" spellCheck={false} value={draft ?? ""} onChange={(e) => setDraft(e.target.value)} onKeyDown={onSubmitKey(save)} />
      ) : data.kind === "md" ? (
        <article className="doc shadowed"><Markdown text={stripFrontmatter(data.content)} slug={p.slug} /></article>
      ) : (
        // Untrusted HTML: scripts may run, but in an opaque origin the API refuses.
        <iframe key={data.modifiedAt} className="doc-frame" sandbox="allow-scripts" src={`/api${base}/raw`} title={data.title} />
      )}
    </div>
  );
}
