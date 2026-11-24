# LOOM - rules for coding agents

## Code Standards (hard rules, not preferences)

## Simplicity is the first principle

The priority order is explicit: **human readability comes first; coding-agent
traceability is the minimum gate.** A human should understand code in one pass.

1. **Code a human can't follow at a glance is a bug.** If a reviewer can't read
   a function top-to-bottom in one pass, restructure or delete it. Nesting,
   indirection, and clever constructs count against correctness — cleverness
   that costs comprehension is a defect, whatever it saves.

2. **Too much / redundant code is a bug.** Solve the problem in the fewest lines
   that stay readable. Prefer deleting code over adding it. A fix that adds more
   than ~20 lines for a problem statable in one sentence is suspect — find the
   smaller fix first.

3. **Simplicity is the core engineering metric.** When two designs both work,
   ship the one with less code, fewer concepts, fewer files. Never add config,
   record types, or return-shape changes "for the future".

4. **No over-encapsulation.** No new class / helper / module for a
   single call site. A helper needs 3+ real call sites AND nontrivial logic —
   otherwise inline it. Never wrap trivial code. Never change a function
   signature or return shape to thread data that only one caller needs.

5. **Simplicity is not deletion of capability.** Features, performance knobs,
   and observability are intentional — do not remove them in the name of
   simplicity. Knobs default ON stay ON. Simplify the implementation, keep
   the behavior surface.

## Comments

Concise "why" only, 2-4 lines, written for an external reader: no job ids,
commit hashes, single-run metrics, or internal cluster paths; keep upstream
issue/PR links.

## Design and decisions

`docs/design/README.md` maps the design pages; read the one for the area you are changing,
a section at a time. `docs/adr/` holds the decisions. A change that alters a design updates
its page, and a new or reversed decision adds an ADR, in the same change.
