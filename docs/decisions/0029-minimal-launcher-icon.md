# 0029 — Minimal corner-flush launcher icon

- **Status:** Accepted
- **Date:** 2026-05-10
- **Version:** 1.9.5

## Context

Through v1.9.4 the panel launcher was a 40×40px circle pinned to the
bottom-right with a 16px gutter, showing both the unique-error count
and a "BB" wordmark, color-coded green / amber / red. The "BB" label
was added early as a discoverability nudge.

Field feedback from the operator after dogfooding in production-like
parent apps:

- The 40px circle plus "BB" label is **visually noisy** at idle, when
  there are zero errors and the launcher is just decoration. On small
  screens it overlaps with real UI.
- The "BB" wordmark is **redundant** once the team knows what the dot
  is. The number alone carries the signal.
- A separate motivation — making it easier for non-tech teammates to
  share errors back — was discussed and an "icon-level copy via
  right-click / long-press" prototype was built, then rejected before
  shipping. See "Rejected: icon-level share affordance" below.

No prior ADR pins the launcher's visual design; this is the first one.

## Decision

Replace the 40px circle with a **two-state corner-flush launcher**:

- **Idle (0 unique errors):** an 8×8px green dot, flush to the bottom-
  left corner of the viewport (`bottom: 0; left: 0`), no padding, no
  text, no shadow. Almost invisible — the goal is "don't disturb the
  app."
- **Active (≥1 unique error):** grows to a 22×22px rounded square
  (3px radius) showing the integer count. Color: amber (1–5) or red
  (6+). Subtle shadow. Single ripple pulse on each new-error arrival,
  then idle.
- **Click:** opens the panel (unchanged behavior). This is the **only**
  icon action.
- **Silenced indicator:** the existing yellow corner dot is preserved
  on the active state only, scaled down (7×7px instead of 10×10px).

The popup / panel design is intentionally **unchanged**.

## Reasoning

- **Idle dot < 1% of screen real estate.** An 8×8px element flush to
  the corner is below the threshold at which a user would notice or
  feel obstructed by the tool. Compared to the 40×40 circle + 16px
  gutter (effectively a 56×56 hit zone), this is ~2% of the prior
  footprint.
- **Position swap to bottom-left** was considered to avoid clutter on
  the right edge (where chat widgets, "back to top" buttons, and our
  own panel-when-open all live). Bottom-left is occupied in Next.js
  dev by the build indicator, but only in dev — and our launcher
  itself is dev-only, so the collision risk is low and acceptable.
- **Single pulse on arrival, not continuous breathing.** A continuous
  pulse would be more noticeable but defeats the "less disturbing"
  goal. A one-shot ripple draws the eye exactly when something
  changed, then disappears.
- **No "BB" wordmark.** Discoverability is no longer the priority; the
  operator and team already know what the dot means. The wordmark was
  costing more in noise than it earned in clarity.
- **Square vs circle for active state.** A rounded square reads as
  "info badge" rather than "decoration / promo blob", aligning with
  the tool's purpose.

## Alternatives considered

- **Keep bottom-right, just shrink.** Rejected — the operator wanted
  bottom-left specifically to free the right edge for app UI.
- **Hide the icon entirely at idle.** Rejected — the dot doubles as a
  liveness signal that BB is actually loaded and listening. Going to
  zero pixels would hide that.
- **Continuous slow pulse on unacked errors.** Rejected as too
  disturbing; defeats the goal.
- **Hover to expand.** Rejected — useless on touch devices and
  introduces a hover state the user has to discover.

## Rejected: icon-level share affordance

An initial draft of this ADR added a second action to the launcher
icon — right-click on desktop, long-press on mobile — that copied all
unacked errors as markdown to the clipboard, intended as a one-gesture
share path for non-technical teammates ("right-click, paste to chat").
A pill variant with a dedicated "copy" half + "open panel" half was
also discussed.

**Rejected for shipping.** Reasons:

- **Click semantics that flip by state is a UX anti-pattern.** A pill
  where click-copies-when-errors-exist but click-opens-panel-when-idle
  is unpredictable; teammates can't form a stable mental model of what
  the icon does.
- **The pill defeats the "less intrusive" goal.** A two-segment ~44×22
  pill in the corner is louder than a single 22×22 badge, which
  contradicts the primary motivation of this ADR.
- **Friction was overstated.** The current sharing flow is "open
  panel → click Copy in header → paste" — two clicks. Shaving to one
  click on the icon doesn't materially change whether teammates share.
  What actually moves that needle is whether the in-panel Copy button
  is prominent and labelled, not whether the launcher has a shortcut.
- **The operator is the primary user.** Optimizing for an occasional
  teammate share by adding clicks (or hidden-gesture discovery cost)
  to the operator's frequent-use workflow is a bad trade.
- **Hidden-gesture discoverability is weak.** Right-click and
  long-press aren't visible affordances. Tooltips on mobile are
  unreliable. A teammate would never find the feature without being
  told.

If sharing becomes a measured problem later — i.e. teammates *see* the
errors and still don't share them — the right move is to make the
in-panel Copy button more prominent (which would constitute a panel
design change, currently out of scope), not to layer hidden gestures
onto the launcher.

## Implementation notes

- Pulse uses a `@keyframes bb-pulse-ring` keyframe injected once into
  `document.head` (id `bb-launcher-keyframes`). Inline `style` props
  can't host `@keyframes`.
- Pulse is triggered by a `useEffect` watching `uniqueCount`; when it
  exceeds the ref-tracked previous value, `pulseKey` increments,
  remounting the ring element so the animation restarts from frame 0.

## Consequences

- The launcher footprint drops from ~56×56 (40px circle + 16px gutter)
  to 8×8 at idle and 22×22 at active. Visible-pixel cost on idle screens
  is ~2% of the prior amount.
- The dot is small enough that someone unfamiliar with BB might not
  notice it at all in production-mode previews. Acceptable — BB is a
  dev-mode tool; if the dot is invisible to end users that's a feature.
- Sharing flow is unchanged from v1.9.4: open panel, click Copy in
  header, paste. If teammate adoption of "send Ahmad an error" turns
  out to be a measured problem, revisit by making the in-panel Copy
  button more prominent rather than layering icon-level gestures.
- If we later want a discoverability nudge for first-time installs, it
  should be a one-shot tooltip on the first error of a session, not a
  permanent label.

## Supersession path

If a future iteration wants to revive the wordmark or grow the idle
footprint (e.g. for adoption nudges on first install), supersede this
ADR with explicit reasoning. Don't silently revert.
