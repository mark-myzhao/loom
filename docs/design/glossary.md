# Glossary

## Summary

Five words carry the design: Loom (the app and its files), Shuttle (the resident agent the owner talks to), Thread (one run of an agent on a task), Bobbin (one Shuttle session) and Pick (one Shuttle turn). Everything that already has a plain name keeps it: task, run, envelope, note, ledger.

## The five words

Five words carry the design. Each names something the owner sees or a cost they pay; anything that already has a plain name keeps it.

| Term | On a real loom | In Loom |
| --- | --- | --- |
| Loom | The frame that holds the work under tension. | The app and its data directory. The files are the cloth: what is woven stays woven. |
| Shuttle | Carries the weft back and forth across the warp. | The resident agent and the owner's one conversation. It carries each thing the owner says to the task or Thread it belongs to, and carries back only what needs them. It routes and never does the work. |
| Thread | One continuous strand in the cloth. | One run of an agent on a task, addressed by the task and its number (`T-006.2`). A task may have several: work picked up cold is the next Thread, which continues from the earlier one's report in the same worktree and branch, and others may run beside it. |
| Bobbin | The spool inside the shuttle. It runs out and is swapped without stopping the weave. | One session of the Shuttle: a context window and its prompt cache. Swapped when cold or full. |
| Pick | One pass of the shuttle across the cloth. | One Shuttle turn: everything that arrived since the last one, answered in one go. A pick that uses tools is several model calls. |

## Plain words that stay

| Term | Meaning | Relation to the five |
| --- | --- | --- |
| Task | Something the owner has to get done; one file. A project is the root task of its directory, `T-000`. | Also the brief its Thread works from. "Brief" is a description, not a second object. |
| Run | One process: one Claude Code session started or resumed by Loom. | A Thread is one run, resumed while its cache is warm. A bobbin is one Shuttle run. Ingest, ask and automations are runs that are not Threads. The owner should rarely need this word. |
| Envelope | The lines Loom adds around the owner's message: time, changes, and at the start of a bobbin the hand-over. | Written by code, read by the Shuttle. |
| Note | Up to 100 words sent to a task's Thread, from the owner or from an agent, in practice the Shuttle. | Recorded on the timeline; reaches a running Thread at its next step. |
| Ledger | The list of open work, computed from the files. | Feeds both the envelope and the board. |
| Needs you | Threads that are asking, broken or ready for review. | The first group on the board. |
| Artifact | Anything the work reads or produces, one file each: a document, a link or a repository. | What a "source" and a registered repo were. See [The graph](graph.md). |
| Memory, Timeline | As defined in the data conventions. | A task's timeline is its edges in order, and says which Threads worked on it and what they wrote. |

Left unnamed on purpose: warp, weft, heddle, selvedge, knot. They are good words with no job yet. "Coding agent" and "worker" retire from the UI in favour of Thread; `RunKind` in the code keeps its values.
