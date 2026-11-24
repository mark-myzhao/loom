# Marks

## Summary

Two marks in the style of the Loom wordmark: the weft crossing the warp for the Shuttle and an over-under strand for a Thread, whose colour shows its state. SVG source is below; they are drawn at size in the pictures page.

## The marks

Drawn like the Loom wordmark: one stroke, 3.2 units on a 32-unit grid, round caps and joins, no fill, burnt orange (`#ee7446` on dark, `#c2401b` on light). The Shuttle is the weft it carries: a line going over, under and over three warp threads and on, an arrow, so it reads as routing and shares the Loom mark's vertical rhythm ([ADR 0019](../../adr/0019-shuttle-page-and-live-graph.md); it replaced a boat shuttle that read as a leaf at small sizes). The Thread is one strand going over and under; its colour is its state (grey proposed or queued, orange and moving when running, amber asking or blocked, red and split in two when broken, blue for review, green done). In the app they are `ShuttleMark` and `ThreadMark` in `web/ui.tsx`, on the rail's Shuttle link, the Shuttle page and each board row. They are shown at size in [the pictures](../pictures.html). The rail's pages carry icons drawn the same way, in the text colour and orange when current: a calendar for Today, the Shuttle mark, a pulse for Activity, a repeat loop for Automations and bars for Usage (`PAGES` in `web/main.tsx`).

```
<!-- Shuttle -->
<svg viewBox="0 0 32 32" fill="none" stroke="#ee7446" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 4v7.5M5 20.5V28M12 4v24M19 4v7.5M19 20.5V28"/>
  <path d="M2.5 16h6.5M15 16h14M24 11l5 5-5 5"/>
</svg>

<!-- Thread -->
<svg viewBox="0 0 32 32" fill="none" stroke="#ee7446" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 20c4.5 0 4.5-8 9-8s4.5 8 9 8 4.5-8 9-8"/>
</svg>
```
