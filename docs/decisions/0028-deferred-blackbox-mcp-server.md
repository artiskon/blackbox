# 0028 — DEFERRED: `@artiskon/blackbox-mcp` server package

- **Status:** Deferred
- **Date:** 2026-05-05
- **Version:** —

## Context

The DigitalDen runner-integration handoff (May 2026) suggested a small
sibling package `@artiskon/blackbox-mcp` exposing `fetch`, `search`,
`clear`, `suggest-adr` over MCP — letting agents call BB programmatically
through the MCP transport instead of shelling out to the CLI.

The handoff itself ranked this as the lowest-priority item ("post-launch
polish; the runner reads `__blackbox` directly via Firebase Admin SDK
today and that works").

## Decision

**Defer.** The current shell-out path works; the runner integration v1
rollout doesn't need MCP transport. Revisit when (a) item 0027
(recurrence ADR suggestion) ships and the suggestion-generation surface
is settled, or (b) a second consumer expresses interest.

## Reasoning

- **No unblocked workflow.** CLI shell-out is functional. The runner
  reads `__blackbox` via Admin SDK without going through BB at all.
  There is no agent-flow that's stuck waiting on MCP.
- **Premature design surface.** The MCP package would expose `fetch` /
  `search` / `clear` / `suggest-adr`. Three of those mirror existing CLI
  commands (`bb-check`, `bb-clear`, `bb-suggest-adrs` per ADR-0027); one
  doesn't exist yet. Designing the MCP shape before `bb-suggest-adrs`
  exists in CLI form locks an interface in before the underlying behavior
  is settled.
- **Maintenance cost.** A separate package means a separate release
  cadence, separate version lock with the consumer, separate CHANGELOG.
  Justified when there's a real workflow demand; not justified for
  "polish."
- **MCP transport is consumer's choice.** A consumer who really wants
  MCP today can wrap the existing CLI in their own MCP server in 50
  lines of glue. The work is small if the demand is real, and bigger as
  a published @artiskon package because of the support surface.

## What would change the calculus

- A second consumer (beyond DigitalDen) asks for MCP transport. One ask
  is suggestive; two is signal.
- ADR-0027 ships and the `bb-suggest-adrs` CLI shape is settled enough
  that the MCP wrapper has a stable target. (Until then, MCP shape
  would have to track CLI evolution.)
- An agent workflow appears that genuinely cannot shell out (sandboxed
  agent environment, etc.). None today.

## Trade-offs / what we explicitly didn't do

- We did NOT scaffold an empty `@artiskon/blackbox-mcp` package as a
  placeholder. Empty packages on npm rot.
- We did NOT add MCP-server primitives inside the main `@artiskon/blackbox`
  package. The MCP server is a node-only consumer of BB data, not a
  capability of BB itself; bundling it would bloat the main package.

## Subsequent feedback

- None yet. If a future agent proposes this, ask them: which workflow
  is blocked today by the absence of MCP transport that wouldn't be
  unblocked by `bb-check` + jq?
