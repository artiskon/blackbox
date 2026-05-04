# 0017 — Deferred: React fiber component lineage on resource_load

- **Status:** Deferred (revisit if asked 3+ more times or if `data-bb` proves insufficient)
- **Date:** 2026-05-04
- **Latest re-ask:** BB-1.8 agent feedback batch (acted on in v1.9.2)

## The recurring ask

Multiple sessions have asked for a "React fiber tree at error time" or "displayName chain" on resource_load errors — e.g. *"InstagramPostCard > Avatar > img"* or *"rendered inside ItemCard inside ItemGrid inside MediaLibrary."*

## Why we have NOT shipped this

1. **Fragile across React versions.** Walking `el.__reactFiber$xxx` (or `_reactInternals` in older versions) depends on internal property naming that changes between React majors and minors. Production-minified bundles strip displayName by default — the chain would be `Wn > pX > yI > img` which is no better than what we have.

2. **High implementation cost vs. marginal gain over `data-bb`.** The existing `data-bb` attribute convention covers ~80% of the use case at zero runtime cost. ADR-0005's auto-label waterfall covers another chunk via `aria-label` / parent text / img alt. The remaining ~20% (anonymous components rendering bare DOM) is the hardest case and the one where fiber walking would also fail (no displayName).

3. **`registerDiagnostic` (ADR-0014) is the better escape hatch.** A consumer who really needs component-name attribution can write a 10-line diagnostic that walks fiber for *their* known components and surfaces the chain in `context.diagnostics.componentChain`. Doesn't require BlackBox to ship fiber-walking code that breaks on React 19.5.

## Conditions to revisit

- **Asked 3+ more times by different sessions** AND
- (`data-bb` adoption proves consistently impractical — e.g. the consumer can't modify a third-party component library) OR
- React stabilizes a public API for `getCurrentFiber()` / similar

If revisited, the implementation would be:
- An optional `init({ captureComponentLineage: true })` flag (off by default — runtime cost on every error)
- Walks fiber from `errorEntry.context.target` (which the resource hook would need to start retaining) up to the root, collecting `type.displayName || type.name` at each level, capped at 6 levels
- Returns `null` (not a fake chain) on minified production bundles where displayName is stripped

## Subsequent feedback

- BB-1.8 agent (acted v1.9.2 batch) re-asked. Premise unchanged; not flipping. The agent's example (`InstagramPostCard > Avatar > img`) is exactly the case where `data-bb="instagram-post-card"` on the wrapper would solve it for free.
