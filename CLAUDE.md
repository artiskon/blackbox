# CLAUDE.md — house rules for AI assistants editing @artiskon/blackbox

This is the source of the `@artiskon/blackbox` npm package. It's a git submodule consumed by parent apps (which install it from GitHub or via the local submodule path).

## CRITICAL RULE: update related docs with every code edit

**After every code edit, before declaring the work done, ask: does this change anything a user (developer or AI assistant) would read in a doc? If yes, the doc update is part of the SAME change, not a follow-up.**

This rule has been violated repeatedly across v1.8.0 → v1.9.0. `CLAUDEMD-SNIPPET.md` was kept current; `README.md`, `INSTALL-PROMPT.md`, and `BLACKBOX-PROMPT.md` lagged three minor versions behind. The most damaging staleness was BLACKBOX-PROMPT still telling AI assistants that `resource_load` errors include `httpStatus` (404 = missing, 0 = CORS) — both the field name and the CORS interpretation were wrong post-v1.9 and would actively mislead the next debugging session.

### Trigger this rule when changing:
- CLI commands, flags, or options → README CLI table, BLACKBOX-PROMPT step lists, CLAUDEMD-SNIPPET, INSTALL-PROMPT scripts
- Public API surface (exports, helpers, hook signatures) → README sections, the matching `.d.ts` files (both at `src/*.d.ts` AND the sibling `src/core/hooks/*.d.ts` — TypeScript consumers importing directly from the source paths resolve the local one first), CLAUDEMD-SNIPPET method list
- Field names users see in error context, breadcrumbs, or reports → BLACKBOX-PROMPT Step 4 reference, CLAUDEMD-SNIPPET, README
- `init()` config options → README Privacy/Configuration table, `src/index.d.ts`, CLAUDEMD-SNIPPET
- Error source labels, `urlReachability` values, fingerprint behavior → BLACKBOX-PROMPT Reference, CLAUDEMD-SNIPPET
- Version bumps → `package.json`, `src/components/BlackBoxPanel.js` `_version` literal, CLAUDEMD-SNIPPET headline, README version references. Grep the old version string before claiming the bump is done.
- Renames of any user-visible string → every doc that quotes the old name (use grep, don't trust memory)

### Skip this rule for:
- Internal refactors with no API change
- Bug fixes that make code match what docs already say
- Test additions
- Private helper changes

### Operational expectations
- Audit the docs list at the **start** of any non-trivial code change, not the end. The list is: `CLAUDEMD-SNIPPET.md`, `README.md`, `INSTALL-PROMPT.md`, `BLACKBOX-PROMPT.md`, plus any `*.d.ts` (both at `src/*.d.ts` and `src/core/hooks/*.d.ts`) whose corresponding `.js` you touched.
- Include doc edits in the **same commit** as the code edit. They describe the same change.
- "I'll update docs in a follow-up" is the wrong answer. At minimum, surface in the end-of-turn summary that docs are pending so the user can hold you to it.

## Build & release flow

- Source lives in `src/`; tsup builds `dist/` (committed because consumers may install from a path, not just npm).
- After any code change, run `npm run build` and commit the regenerated `dist/` chunks alongside the source change.
- Bumping the version: edit `package.json`, edit `src/components/BlackBoxPanel.js` `_version` literal, edit the headline section in `CLAUDEMD-SNIPPET.md`, then build, commit, push to the `main` branch on GitHub, then bump the parent repo's submodule pointer.

## CLI tools live in `src/cli/`

`bb-check`, `bb-health`, `bb-timeline`, `bb-clear`, `bb-ack`. These are bin entries in `package.json` and run as plain `.js` (not built). Don't add a transpilation step for them.

## Monitor: launch freely, signal at end of reply

When a Monitor task is the right tool, **just launch it**. Don't preface with "I'll arm a Monitor", don't pause to confirm, don't suggest alternatives. After launching, end the reply with this exact line rendered as a level-1 heading (big + bold):

```
# **Don't Close Chat, Monitor in Process**
```

This applies to any reply where a Monitor task is armed in that turn (or carries over from a prior turn). Skip any "Monitor armed" / "awaiting events" preamble — go straight from the work into the heading. Bash `run_in_background` does NOT trigger this — only Monitor does.
