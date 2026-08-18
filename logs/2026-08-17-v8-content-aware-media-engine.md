# V8 — Content-Aware Media Engine

**Date:** 2026-08-17

## Objective

Make the V7 renderer (a dumb scene-order concatenator) genuinely content-aware: voiceover-driven scene timing, captions, title/lower-third overlays, transitions, background music, aspect-ratio-aware framing, and Short-highlight selection — all exposed through a usable Production Studio UI, not just the API.

This followed a separate pre-V8 refactor pass (see the 2026-08-16 changelog entry / commit) that split the monolithic `app.js` into modules and filled in V7 backend routes the frontend was already calling but that didn't exist yet. That refactor is a prerequisite for this log, not part of it.

## Files changed

- `backend/server.js` — new helpers (`ffprobeDuration`, `detectMediaType`, `buildCaptionChunks`, `escapeDrawtext`, `buildDrawtextFilters`, `RENDER_PRESETS`), rewritten upload endpoint (role-based), new endpoints (`PATCH .../production/music`, `POST .../captions/generate`, `GET /api/render-presets`), full rewrite of `_runRender`.
- `js/production.js` — full rewrite: scene-level footage/voiceover attach, captions UI, overlay editor, Include-in-Short toggle, Mix tab (music/transition/crop), preset-driven render trigger.
- `js/app.js` — updated imports and event bindings for all new Production Studio controls.
- `index.html` — Production Studio modal restructured (added Mix tab, preset selector, hidden scene-level file inputs), title bumped to V8.
- `styles.css` — new rules for scene media rows, caption/overlay lists, Mix tab layout.
- `PROJECT.md`, `CHANGELOG.md` — updated for V8 status and known simplifications.

## Implemented

- Role-based asset uploads (`footage` / `voiceover` / `music`), each auto-probed for duration via `ffprobe` when audio/video.
- `scene.durationSeconds` (numeric, render-facing) added as a field distinct from `scene.duration` (existing display string) — see Bugs/issues below for why this distinction matters.
- Caption auto-generation on voiceover attach: narration text split into ~7-word chunks, timed proportionally across the voiceover's real duration. Regeneratable via a dedicated endpoint, toggleable per scene.
- Title and lower-third overlays per scene with independent `[start, end]` windows, burned in via `drawtext`.
- Transitions: hard cut (concat demuxer) or crossfade (`xfade` + `acrossfade`, configurable duration) — built as a chained filter graph across arbitrary scene counts.
- Background music: uploaded once per project, looped/trimmed to the final render's total duration, mixed at a configurable constant volume.
- Crop mode: `pad` (letterbox) or `crop` (fill), applied per project.
- Three render presets (`long-form` 1920×1080, `short` 1080×1920, `square` 1080×1080), exposed via `GET /api/render-presets`.
- Short-format renders prefer scenes flagged `includeInShort`, falling back to all scenes if none are flagged.
- Per-scene render failures (missing footage) are skipped with a warning surfaced on the job rather than failing the whole render silently.
- Full Production Studio UI: Timeline tab (scene cards with footage/voiceover attach, captions, overlays, Short toggle), Assets tab (unassigned b-roll), new Mix tab (music, transitions, crop), Render tab (preset selector, manifest download, job list with warnings).

## What was intentionally not implemented

- Real forced-alignment captions (speech-to-text). Current captions are a proportional word-count split — timing will drift if the voice reads unevenly.
- True sidechain ducking for music. Current implementation is a constant volume attenuation under the voiceover, not dynamic.
- Multi-asset compositing within a single scene (e.g. layering a screen recording under a talking-head clip). One footage clip + one voiceover clip per scene only.
- Wiring V5's Flow-prompt asset requirements (`scene.assetRequirements`) into the V8 render path. That data still exists and is shown in Script Studio, but V8's render engine only looks at direct scene footage/voiceover attachments, not fulfilled asset requirements.
- Inline render preview player — output is a download/open link only.

## Bugs/issues (found via live testing, not caught by code review)

1. **Upload race condition.** `fs.stat()` was called immediately after Busboy's `finish` event, but the destination write stream's own `finish` event (meaning data is actually flushed to disk) could fire after Busboy's. Result: uploaded assets sometimes showed `size: 0`. Fixed by explicitly awaiting the write stream's `finish` promise before resolving the upload handler.
2. **Field collision between display and render-facing duration.** I initially reused the existing `scene.duration` (a free-text string like `"0:00–0:10"` used by `script.js`'s scene cards) to also hold the new numeric render duration. This silently broke caption timing (`duration * number` on a string produces `NaN`, which serializes to `null` in JSON — captions ended up with `end: null`). Fixed by introducing `scene.durationSeconds` as a separate field and auditing every place that needed the numeric value vs. the display string.
3. **MIME-type fragility.** Some upload clients (confirmed with plain `curl` without an explicit `-F ...;type=`) send `application/octet-stream` instead of a proper `audio/*` MIME type for `.m4a` files, causing `mediaType` to resolve to `"file"` and skip duration probing entirely. Added an extension-based fallback (`detectMediaType`).

All three were caught by actually uploading real files through the live HTTP API and inspecting the resulting story JSON — not by reading the code.

## Decisions made

- Kept `scene.duration` (string) and `scene.durationSeconds` (number) as two separate fields rather than migrating the whole app to a numeric-only duration model, to avoid touching every place `script.js` and existing scene templates already display the string.
- Chose per-scene isolated rendering (render each scene to its own normalized clip first, then concatenate) over a single giant `filter_complex` graph spanning every scene. This is slower (many ffmpeg invocations) but far easier to reason about, debug, and partially recover from — one bad scene doesn't take down the whole render, and warnings can be attributed per-scene.
- Music mixing is a simple constant-volume `amix`, explicitly not sidechain-ducked, documented as a known simplification rather than silently shipped as if it were "smart" ducking.

## Verified

Full pipeline tested end-to-end against a live server using synthetic FFmpeg-generated test assets (color-bar video, sine-tone audio) uploaded through the real multipart HTTP endpoint:

- `long-form` render: confirmed 1920×1080 output, correct duration matching voiceover length, video+audio streams present.
- `short` render: confirmed 1080×1920 output (crop mode).
- Extracted a frame from the `long-form` output and visually confirmed both the burned-in title overlay ("V8 Test") and the burned-in caption text render correctly and legibly.
- Confirmed all three found-and-fixed bugs (upload race, duration field collision, MIME fallback) via before/after HTTP calls against the live server, not just by reading the diff.

## Next step

V9 candidates, not yet scoped or committed to:

- Real forced-alignment captions
- True sidechain music ducking
- Multi-asset compositing within a scene
- Wire Flow-prompt asset requirements into the render path
- Inline render preview player in Production Studio
