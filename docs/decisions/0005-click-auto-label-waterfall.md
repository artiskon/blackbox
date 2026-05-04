# 0005 — Click auto-label waterfall (synthesize labels for ALL clickable elements)

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.8.0

## Context

Two debugging sessions reported click breadcrumbs of the form `{type: 'click', el: 'img'}` with no other identifying info. Specifically: profile-pic clicks recorded as bare `<img>` with `className: "h-6 w-6 rounded-full object-cover"` and nothing else — useless for identifying which user / context / component the click belonged to. The pre-existing `getLabel` helper only ran when `text.length < 2 && !dataBb`, and only checked aria-label/title, missing img alt and parent button text.

## Decision

Always synthesize a label via cascading `synthesizeLabel(el)`:

1. `aria-label` → `title` → for `<img>`: `alt` → for `<input>`: `placeholder` || `value` (truncated)
2. Closest interactive ancestor (`button, a, [role="button"]`) text → its aria-label → its title
3. Last resort: parent element textContent first 30 chars

Runs on every click, independent of whether `text` is non-empty (so an icon button with text "×" still records `autoLabel: "Close dialog"`). The breadcrumb consumer can prefer text when present.

## Reasoning

- The previous gate (`text.length < 2 && !dataBb`) was wrong because it skipped the case the dev actually cared about: a bare `<img>` IS a clickable thing in many designs, but its `text` is empty, so the gate triggered — but the existing helper didn't check `alt`, the most discriminating attribute for images.
- Always-synthesizing trades a tiny bit of work for a much more useful breadcrumb. The label is small (~100 chars max).

## Trade-offs / what we explicitly didn't do

- We did NOT walk the React fiber to extract component name (e.g. `ItemCard > Avatar > img`). High implementation cost, fragile across React versions. Deferred — see ADR-0017.
- We did NOT add a config option to disable auto-labeling. Always-on is correct; if users want truly minimal breadcrumbs they can use `sanitize`.
- We did NOT prefer the synthesized label over `text` in the panel display. `text` is canonical when present; `autoLabel` is a fallback / supplement.

## Subsequent feedback

- None directly. Multiple agents have referenced "what was clicked" without complaining about useless `el: 'img'` rows post-1.8.0.
