# What a Thread reads

## Summary

A Thread's brief carries the task, the parent's context and the task's neighbourhood in [the graph](../graph.md): its other Threads, the memory index and a manifest of each linked artifact's title, size and sections with line ranges. Bodies are read a section at a time, since a token read at turn one is re-read every later turn. Documents stay small (a 120-word summary, 1,500 tokens a section, 8,000 a document). Facts live in markdown; HTML is only a visual that a markdown document links, shown inline, and no brief lists it. A Thread is one run: resumed while its cache is warm; cold, the next Thread starts from the files. Part of the design in [the design index](../README.md).

## Today, and the three tiers

A **Thread** is the agent working one task. Today its brief (`taskPrompt`) says of the task's artifacts "read them before you start", and of each ancestor's artifacts "read the ones that bear on" the task. With T-001's 51 KB research page or a 14K-token design page attached, that is 5K to 15K tokens loaded at turn one and carried for the rest of the session. DeepSeek's prototype does the opposite and it transfers almost unchanged.

[Diagram: Three tiers of context for a Thread; drawn in [the pictures](../pictures.html).]

## T1. The brief carries a manifest in place of "read them"

For each artifact of the task and of its ancestors, Loom lists the path, title, approximate size and second-level headings, all computed from the file. The manifest is one group of the task's neighbourhood in [the graph](../graph.md), which adds every artifact the task links to, wherever it lives. No new frontmatter field and nothing for anyone to keep up to date.

```
Documents for this task. Read one section at a time with its line range; never a whole file.
- artifacts/t-003-superagent-research.md   "Super-agent design research"   ~3K tokens
    Summary                       L11-14    ~150
    What was read                 L15-23    ~250
    What they built               L24-35    ~450
    Thinking bigger               L36-72    ~1,300
    Smaller ideas, by value       L73-115   ~1,000
    What Loom already does        L116-122  ~100
    Not worth borrowing           L123-129  ~150
(line ranges are from when this brief was written; search for the heading if they have moved)
```

Change: `art()` in `taskPrompt` prints the outline of each file where it prints one line, and two sentences of instruction change. Headings are `## ` lines in markdown and `<h2>` in HTML.

Built in step 3 as the "what it touches" block of the brief, in the order [the graph](../graph.md) gives: parents, siblings, Threads, documents with their `##` sections and line ranges (a linked section of any level is added and marked), memory, the owner's notes, mentioned by. Line ranges count the frontmatter, so they match the Read tool. HTML documents get no outline until step 4 renders them. The ancestors' Context stays inline below it.

## T2. The memory index goes inline

`MEMORY.md` is already the right shape: one line per entry, and the line is the fact. Printing its five to fifteen lines in the brief saves a tool call and makes "read the body only when the work calls for it" the default instead of an instruction.

## T3. The Shuttle points, it does not paraphrase

When the Shuttle writes a task it names the section that matters as a link (`[[loom:docs/design/shuttle/context.md#R2]]`) in the task's Context, so that section's outline reaches the brief, in the owner's words where it can, and adds no plan. DeepSeek caps the router's note at 30 words for the same reason: a router that rewrites a request loses detail and invents requirements, and the worker then reads both versions. Loom's task format already limits Context to about 120 words, so this is a prompt line, not a mechanism.

## T4. What comes back is a card

The full report stays on the task's timeline, where the owner reviews it. What travels is small: the task's status, a one-line result, and at most one open question, a `question` event on the task's timeline authored by the Thread. This is the same card R5 gives the Shuttle: task id, status, the first line of the report cut at 300 characters, and the question. The Shuttle and the board both read that, never the transcript.

## T5. A Thread is one run; cold work goes to the next Thread

The Shuttle's swap rule ([The Shuttle's context and cache](../shuttle/context.md), R2) applies to Threads too. Answer a Thread's question within the hour and Loom resumes the same session: warm, exact, cheap. Come back the next morning to a 270K session and resuming costs about 540K token-equivalents before it does anything. Then Loom starts the next Thread on the task (`T-006.2` after `T-006.1`) in the same worktree and branch. It opens with the task, the earlier Thread's report as a card, the question and its answer, and DeepSeek's recovery note ("check the directory and git history before repeating anything"), and costs a seventh of that. "Continue" for an interrupted run is the same code path.

What ties a task's Threads together is the task file, the worktree, the branch and the timeline, which records each start, report and hand-over ([The graph](../graph.md)). A task may also have Threads side by side, for a review or a second attempt; the owner starts each.

Rule: resume when the cache is warm (the session's last turn ended under 55 minutes ago); otherwise start the next Thread from the files. Like the Shuttle's, a size budget is deferred until there are numbers. The message that resumes a Thread carries the current time, because the clock in its brief is frozen (R4).

## T6. Documents stay small, sectioned, and in markdown when an agent will work from them

A manifest only helps if the sections behind it are worth opening one at a time. Measured on this project's documents:

| Document | Size | Of which text | Sections |
| --- | --- | --- | --- |
| `t-001-oss-research.html` (before it became markdown) | 51K chars · ~13K tokens | 58% | 9 |
| `t-003-shuttle-design.html` (before it was split) | 56K chars · ~14K tokens | 53% | 8 |
| `t-003-superagent-research.md` | 12K chars · ~3K tokens | ~100% | 7 |

Nearly half of an HTML page is tags, styles and drawings an agent pays for and cannot use. The design page was the worst offender in the project, and has been split under this rule. Four additions to the artifact conventions, none of which needs a new file format:

- **Open with a Summary** of at most 120 words. It is the first thing a Thread reads and often the only thing.
- **A section is at most about 1,500 tokens** and stands on its own: it names what it depends on instead of assuming the reader came from the section above.
- **A document is at most about 8,000 tokens.** Past that, split it by subject into several artifacts of the same task (`t-003-shuttle-context.md`, `t-003-shuttle-board.md`). Loom marks an artifact **Over length** in the manifest and on the task page, the way it already marks memory entries.
- **Facts live in markdown.** HTML is only for a diagram or an interactive piece, linked from a markdown document (T7).

Left out of this design: showing a task's artifacts as tabs on the task page. It is a reading convenience for the owner and no part of the agent work.

Change: four lines in `conventions.md`; a size check beside the existing memory one in `store.ts`. Built in step 4: past 32,000 characters an artifact is marked Over length on the task page, on its card in `GRAPH.md` and in the brief. The check uses the file's size, so an HTML page counts its markup, which is what a Thread would pay to read it.

## T7. Markdown is the source; HTML is only a visual a markdown document links

An HTML page costs an agent about twice its text: on this project's two pages, 51K and 64K characters of HTML held 30K and 37K of text. The first answer was a markdown rendering Loom would generate beside each page. Measured, it saved 24% to 41%, and it meant a converter and two copies of every page to keep in step. The owner chose the other way round ([ADR 0023](../../adr/0023-markdown-is-the-source.md)): write the markdown, and keep HTML for what markdown cannot draw.

- **Facts live in markdown.** Every document an agent or the owner reads for its content is a markdown artifact. The app's markdown view is its template: title, origin, headings, tables and links look the same in every document, and none carries its own layout.
- **HTML is only a diagram or an interactive piece.** It is one self-contained file that holds no fact its markdown document lacks, so nothing is lost when an agent never sees it.
- **The markdown document links it, and the app shows it there.** A link to an HTML artifact in a paragraph of its own (`[[t-007-flow.html]]`) is followed by the page itself, in the same sandboxed frame its own page gets: scripts run, in an opaque origin the API refuses. A link inside a sentence stays a link.
- **The brief points only at markdown.** An HTML artifact is left out of the Documents list; the Thread meets it as a link in the markdown it reads. It keeps its card in `GRAPH.md`, where the link is an edge like any other.

Not built: a check that a document opens with a Summary. The outline in the brief shows whether it does, and the conventions ask for it.

*Change: one rule in `conventions.md`; the frame in `linkMentions` (`web/ui.tsx`); one line in `taskPrompt` that skips HTML. The project's one whole-page HTML artifact, T-001's research page, was rewritten as two markdown artifacts, `t-001-oss-research.md` and `t-001-oss-survey.md`.*

## What stays as it is

The task body and its checklists stay inline, each ancestor's Context inline (they are capped at 120 words and are the shared goal), the sibling list, and the rule that a Thread may write only its own task, timeline, artifacts and decisions in memory.
