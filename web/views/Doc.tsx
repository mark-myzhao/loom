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
              <button onClick={() => go(hashWith("edit", ""))}>Edit source</button>
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
