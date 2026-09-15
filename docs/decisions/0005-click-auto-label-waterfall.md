# 0005 — Click auto-label waterfall (synthesize labels for ALL clickable elements)

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.8.0

## Context

Two debugging sessions reported click breadcrumbs of the form `{type: 'click', el: 'img'}` with no other identifying info. Specifically: profile-pic clicks recorded as bare `<img>` with `className: "h-6 w-6 rounded-full object-cover"` and nothing else — useless for identifying which user / context / component the click belonged to. The pre-existing `getLabel` helper only ran when `text.length < 2 && !dataBb`, and only checked aria-label/title, missing img alt and parent button text.

## Decision

Always synthesize a label via cascading `synthesizeLabel(el)`:

1. `aria-label` → `title` → for `<img>`: `alt` → for `<input>` / `<textarea>`: `placeholder` → `value` only for `submit` / `button` / `reset` inputs → associated `<label>` text → `name` (typed values are never recorded)
2. Closest interactive ancestor (`button, a, [role="button"]`) text → its aria-label → its title. For an icon-only element with no text of its own: a labelled descendant (`img[alt]`, `[aria-label]`, `svg title`)
3. Last resort, only for non-interactive, non-editable targets: parent element textContent first 30 chars

Runs on every click, independent of whether `text` is non-empty (so an icon button with text "×" still records `autoLabel: "Close dialog"`). The breadcrumb consumer can prefer text when present.

## Reasoning

- The previous gate (`text.length < 2 && !dataBb`) was wrong because it skipped the case the dev actually cared about: a bare `<img>` IS a clickable thing in many designs, but its `text` is empty, so the gate triggered — but the existing helper didn't check `alt`, the most discriminating attribute for images.
- Always-synthesizing trades a tiny bit of work for a much more useful breadcrumb. The label is small (~100 chars max).

## Trade-offs / what we explicitly didn't do

- We did NOT walk the React fiber to extract component name (e.g. `ItemCard > Avatar > img`). High implementation cost, fragile across React versions. Deferred — see ADR-0017.
- We did NOT add a config option to disable auto-labeling. Always-on is correct; if users want truly minimal breadcrumbs they can use `sanitize`.
- We did NOT prefer the synthesized label over `text` in the panel display. `text` is canonical when present; `autoLabel` is a fallback / supplement.

## Subsequent feedback

- Through v1.9.5: none directly. Multiple agents referenced "what was clicked" without complaining about useless `el: 'img'` rows post-1.8.0.
- **2026-09-13 (unreleased, after v1.9.5; additive):** four audit fixes, Decision steps above amended in place.
  1. **Privacy leak closed.** Step 1 used to fall back to `el.value` for any `<input>`, so clicking into a password or card-number field recorded what the user had typed. Only button-type inputs use their value now; other fields use `<label>` text or `name`. Text inside a `<textarea>` or `contenteditable` region is never recorded as `text`, and step 3 is skipped there.
  2. **Sibling-text mislabel.** Step 3 on a button returned the parent's text, i.e. its siblings' labels joined ("EditDeleteShare"), and the silence check used `autoLabel || text`, so different buttons in one toolbar matched each other and produced false `user_stuck` reports. Step 3 is now limited to non-interactive targets, the silence check registers `text || autoLabel` (text stays canonical, per the trade-off above), and "same element" in `user_stuck` counting matches by `dataBb`, then `id`, then non-empty text, never on two missing values.
  3. **Label surfaced.** `autoLabel` was captured but never shown. The copied panel report emits it as `label` when a click's `text` is empty (text stays under `text`, so the synthesized value reads as a guess); the panel lists, Markdown export and `bb-check --id` breadcrumbs fall back to it.
  4. **SVG targets.** A click on an unclassed `<path>` / `<rect>` with no interactive ancestor now records the `<svg>` root (tag `svg`, its class). `className` and `href` are read as attributes, so SVG elements no longer record `"[object SVGAnimatedString]"`, and SVG `<a>` links get a string `href` and a silence check.
