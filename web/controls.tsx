import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Loom's own select and date picker, drawn to match the rest of the app instead of the platform's.
// Focus stays on the trigger while the popover is open, so the trigger handles every key.

/** A popover anchored under its trigger (or above, when there is more room there). */
function usePopover() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open) return;
    const place = (e?: Event) => {
      const el = pop.current, a = anchor.current?.getBoundingClientRect();
      if (!el || !a || (e && el.contains(e.target as Node))) return;
      const gap = 5, edge = 8;
      const below = innerHeight - a.bottom - gap - edge, above = a.top - gap - edge;
      const up = el.scrollHeight + 2 > below && above > below;
      const width = Math.max(el.offsetWidth, a.width);
      setStyle({
        left: Math.max(edge, Math.min(a.left, innerWidth - width - edge)),
        top: up ? undefined : a.bottom + gap,
        bottom: up ? innerHeight - a.top + gap : undefined,
        minWidth: a.width,
        maxHeight: up ? above : below,
      });
    };
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !anchor.current?.contains(t)) setOpen(false);
    };
    place();
    anchor.current?.focus();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  /** Rendered on the body, so no card clips it and no enclosing label takes its clicks. */
  const render = (className: string, props: Record<string, unknown>, children: ReactNode) =>
    open && createPortal(
      <div ref={pop} className={`popover ${className}`} style={style} onMouseDown={(e) => e.preventDefault()} {...props}>{children}</div>,
      document.body,
    );
  return { open, setOpen, anchor, pop, render };
}

/** Enter and Space are handled on keydown, so the button's own click must not fire as well. */
const noSpaceClick = (e: KeyboardEvent) => e.key === " " && e.preventDefault();

const Chevron = () => (
  <svg className="select-icon" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 3.75L5 6.75l3-3" />
  </svg>
);

// ---------- select ----------

export type Option = { value: string; label?: string };

export function Select({ value, options, onChange, className = "", "aria-label": ariaLabel }: {
  value: string; options: Option[]; onChange: (value: string) => void; className?: string; "aria-label"?: string;
}) {
  const { open, setOpen, anchor, pop, render } = usePopover();
  const [active, setActive] = useState(0);
  const typed = useRef({ text: "", at: 0 });
  const id = useId();
  const text = (o: Option) => o.label ?? o.value;
  const current = options.find((o) => o.value === value);

  const show = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const pick = (o: Option | undefined) => {
    setOpen(false);
    if (o && o.value !== value) onChange(o.value);
  };
  useEffect(() => {
    if (open) pop.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onKeyDown = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const move = (i: number) => (e.preventDefault(), open ? setActive(Math.max(0, Math.min(last, i))) : show());
    if (e.key === "ArrowDown") move(active + 1);
    else if (e.key === "ArrowUp") move(active - 1);
    else if (e.key === "Enter" || e.key === " ") (e.preventDefault(), open ? pick(options[active]) : show());
    else if (!open) typeahead(e);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(last);
    else if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), setOpen(false));
    else typeahead(e);
  };
  /** Typing letters jumps to the option that starts with them. */
  const typeahead = (e: KeyboardEvent) => {
    if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = typed.current, now = Date.now();
    t.text = (now - t.at > 600 ? "" : t.text) + e.key.toLowerCase();
    t.at = now;
    const i = options.findIndex((o) => text(o).toLowerCase().startsWith(t.text));
    if (i < 0) return;
    if (open) setActive(i);
    else pick(options[i]);
  };

  return (
    <>
      <button
        ref={anchor} type="button" className={`select ${className}`} role="combobox" aria-label={ariaLabel}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKeyDown} onKeyUp={noSpaceClick} onBlur={() => setOpen(false)}
      >
        <span className="select-value">{current ? text(current) : value}</span>
        <Chevron />
      </button>
      {render("menu", { id, role: "listbox" }, options.map((o, i) => (
        <div
          key={o.value} id={`${id}-${i}`} role="option" aria-selected={o.value === value}
          className={`menu-item${i === active ? " active" : ""}`} onMouseMove={() => setActive(i)} onClick={() => pick(o)}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3.6 8.4l2.9 2.9 5.9-6.4" />
          </svg>
          <span>{text(o)}</span>
        </div>
      )))}
    </>
  );
}

// ---------- date ----------

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
};
/** Sunday first: 1 January 2023 was a Sunday. */
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2));

/** A date as YYYY-MM-DD, or "" for none. */
export function DateInput({ value, onChange, placeholder = "No date" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  const { open, setOpen, anchor, render } = usePopover();
  // The day the arrow keys are on; the calendar shows its month.
  const [cursor, setCursor] = useState(() => new Date());
  const y = cursor.getFullYear(), m = cursor.getMonth();
  const today = iso(new Date());

  const show = () => {
    setCursor(value ? parse(value) : new Date());
    setOpen(true);
  };
  const pick = (v: string) => {
    setOpen(false);
    if (v !== value) onChange(v);
  };
  const byDays = (n: number) => setCursor(new Date(y, m, cursor.getDate() + n));
  /** The same day in another month, or that month's last day if it is shorter. */
  const byMonths = (n: number) => setCursor(new Date(y, m + n, Math.min(cursor.getDate(), new Date(y, m + n + 1, 0).getDate())));

  const onKeyDown = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = open
      ? {
          ArrowLeft: () => byDays(-1), ArrowRight: () => byDays(1), ArrowUp: () => byDays(-7), ArrowDown: () => byDays(7),
          PageUp: () => byMonths(-1), PageDown: () => byMonths(1),
          Enter: () => pick(iso(cursor)), " ": () => pick(iso(cursor)),
          Escape: () => (e.stopPropagation(), setOpen(false)),
        }
      : { ArrowDown: show, Enter: show, " ": show, Backspace: () => pick(""), Delete: () => pick("") };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };

  const first = 1 - new Date(y, m, 1).getDay();
  const days = Array.from({ length: 42 }, (_, i) => new Date(y, m, first + i));
  return (
    <>
      <button
        ref={anchor} type="button" className="select" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKeyDown} onKeyUp={noSpaceClick} onBlur={() => setOpen(false)}
      >
        <span className={`select-value${value ? "" : " placeholder"}`}>
          {value ? parse(value).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : placeholder}
        </span>
        <svg className="select-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="3.5" width="12" height="10.5" rx="1.5" />
          <path d="M2 7h12M5.5 1.75v3M10.5 1.75v3" />
        </svg>
      </button>
      {render("cal", { role: "dialog", "aria-label": "Choose a date" }, (
        <>
          <div className="cal-head">
            <strong aria-live="polite">{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
            <button type="button" className="cal-nav" tabIndex={-1} aria-label="Previous month" onClick={() => byMonths(-1)}>‹</button>
            <button type="button" className="cal-nav" tabIndex={-1} aria-label="Next month" onClick={() => byMonths(1)}>›</button>
          </div>
          <div className="cal-grid">
            {WEEKDAYS.map((d) => <span key={d} className="cal-dow">{d}</span>)}
            {days.map((d) => {
              const v = iso(d);
              const cls = [d.getMonth() !== m && "out", v === today && "today", v === value && "selected", v === iso(cursor) && "cursor"].filter(Boolean).join(" ");
              return (
                <button
                  key={v} type="button" tabIndex={-1} className={`cal-day ${cls}`} aria-pressed={v === value}
                  aria-label={d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} onClick={() => pick(v)}
                >{d.getDate()}</button>
              );
            })}
          </div>
          <div className="cal-foot">
            <button type="button" className="link" tabIndex={-1} onClick={() => pick(today)}>Today</button>
            {value && <button type="button" className="link" tabIndex={-1} onClick={() => pick("")}>Clear</button>}
          </div>
        </>
      ))}
    </>
  );
}
