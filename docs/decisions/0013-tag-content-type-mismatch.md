# 0013 — Tag content-type mismatch detection

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.9.2

## Context

A BB-1.8 debugging session reported "the most misleading BlackBox experience this session": URLs returned HTTP 200 with content correctly served, but the `<img>` tag couldn't decode them because the content-type was `application/pdf` or `video/mp4`. Browsers raise a generic resource-load error event with no status; v1.8 BlackBox labeled this `cors_blocked` (per ADR-0007's supersession), v1.9.0 would have labeled it `'ok'` since the probe succeeded with a 200 — both wrong-leading. The actual bug was an asset-id mapping issue rendering the wrong KIND of file in the wrong element.

## Decision

In `resourceHook.js`, after the probe returns 2xx/3xx, check the response's `content-type` against `TAG_CONTENT_TYPES[tag]`:

- `img` → `^image/`
- `script` → `^(application|text)/(javascript|ecmascript|json)`
- `link` → `^text/css`
- `video` → `^video/`
- `audio` → `^audio/`
- `source` → `^(video|audio|image)/`

When the content-type doesn't match, set `urlReachability: 'tag_content_type_mismatch'`, attach `contentType` (the actual one), and `action_hint`: `<img> tag received "video/mp4" — element rendered the wrong KIND of file. Check the asset-id / URL mapping at the call site.`

## Reasoning

- The probe already captured content-type as of v1.9.0 (per ADR-0007's Range GET upgrade). Detection is one regex check away — high leverage.
- Distinct `urlReachability` value rather than overloading `'ok'` because the dev's diagnosis path is genuinely different. "Server returned 200" → look at the renderer; "200 with wrong content-type" → look at the asset-id mapping.
- The `action_hint` mirrors the gold-standard pattern from the Firestore-index-creation hint and ADR-0015.

## Trade-offs / what we explicitly didn't do

- We did NOT detect mismatches at the network hook (i.e. server-rendered `<img>` content types fetched directly via `fetch()`). The error event from the `<img>` element is the right trigger — fetching alone doesn't tell us which tag the bytes were destined for.
- We did NOT walk back through the React fiber to surface `<img>` source props. That's covered by ADR-0017 (deferred).
- We did NOT add `<picture>` or `<iframe>` to the tag map. The error event for `<picture>` fires on its `<source>` children which are already covered. `<iframe>` rarely surfaces this class of bug.

## Subsequent feedback

- None directly. The classifier ships with the v1.9.2 release.
