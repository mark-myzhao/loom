# Marks

## Summary

Two marks in the style of the Loom wordmark: a boat shuttle for the Shuttle and an over-under strand for a Thread, whose colour shows its state. SVG source is below; they are drawn at size in the pictures page.

## The marks

Drawn like the Loom wordmark: one stroke, 3.2 units on a 32-unit grid, round caps and joins, no fill, burnt orange (`#ee7446` on dark, `#c2401b` on light). The Shuttle is a boat shuttle seen from above, tilted mid-throw, with the bobbin as the bar inside. The Thread is one strand going over and under; its colour is its state (grey proposed or queued, orange and moving when running, amber asking or blocked, red and split in two when broken, blue for review, green done). In the app they are `ShuttleMark` and `ThreadMark` in `web/ui.tsx`, on the Shuttle header and each board row. They are shown at size in [the pictures](../pictures.html).

```
<!-- Shuttle -->
<svg viewBox="0 0 32 32" fill="none" stroke="#ee7446" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
  <g transform="rotate(-24 16 16)"><path d="M3 16C9 6 23 6 29 16 23 26 9 26 3 16Z"/><path d="M12 16h8"/></g>
</svg>

<!-- Thread -->
<svg viewBox="0 0 32 32" fill="none" stroke="#ee7446" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 20c4.5 0 4.5-8 9-8s4.5 8 9 8 4.5-8 9-8"/>
</svg>
```
