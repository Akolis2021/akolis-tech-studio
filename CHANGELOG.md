# Changelog

## 2026-08-20 — Autopilot

### Added

- One-click hands-off pipeline: `POST /api/stories/:id/autopilot` writes the script if missing, generates per-scene voiceover via Google Cloud TTS for any scene without one, fetches stock b-roll via Pexels for any scene without footage, then queues a render — never overwriting footage/voiceover the user already attached themselves.
- Standalone per-scene auto-fill endpoints: `POST /api/stories/:id/script/scenes/:sceneId/voiceover/auto` and `.../visual/auto`.
- "✨ Run Autopilot" button and live status panel in Production Studio's Timeline tab; inline `<video>` preview player on the Render tab for the most recent completed render.
- Requires an approved editorial angle before it will run — this is a deliberate, non-optional gate (see `logs/2026-08-20-autopilot.md`).
- `backend/.env.example` documenting `GOOGLE_TTS_API_KEY`, `GOOGLE_TTS_VOICE`, `PEXELS_API_KEY`.

### Fixed

- `.job-status` CSS referenced `.completed`/`.failed` classes that the backend never actually emits (it emits `"done"`/`"error"`) — render job status text was rendering unstyled. Fixed to match.

## 2026-08-20 — Workflow clarity pass

### Changed

- Research Studio, Script Studio, and Production Studio are no longer navigational dead ends: approving an angle now surfaces a "Continue to Script Studio" action, and generating a script surfaces a "Continue to Production Studio" action, each jumping directly into the next stage for the same story.
- Production Studio's Timeline tab shows a "Go to Script Studio" action when a story has no scenes yet, instead of a plain notice.
- Script Studio's Overview tab surfaces a notice when a story has no approved angle yet.
- Story cards on the dashboard now show a one-line status hint under each of the Research/Script/Production buttons (e.g. "✓ angle approved", "6 scenes", "2/6 scenes ready") so progress is visible without opening a modal.
- Removed internal version numbers (`V4`, `V5`, `V8 · MEDIA ENGINE`) from user-facing modal headers and the page title; fixed a matching stale `V4` string in the backend startup log.

## 2026-08-17 — V8 Content-Aware Media Engine

### Added

- Role-based uploads (`footage` / `voiceover` / `music`) with automatic media-type detection (MIME + file-extension fallback) and `ffprobe` duration detection.
- Voiceover-driven scene timing via new `scene.durationSeconds` field (kept separate from the pre-existing `scene.duration` display string to avoid breaking earlier UI).
- Auto-generated, editable, regeneratable captions (`buildCaptionChunks`, `POST /api/stories/:id/script/scenes/:sceneId/captions/generate`).
- Title and lower-third text overlays per scene, burned in with `drawtext`, each independently timed.
- Scene transitions: hard cut or crossfade (`xfade`/`acrossfade`), configurable duration.
- Background music: uploaded, looped/trimmed to final length, mixed at configurable volume (`PATCH /api/stories/:id/production/music`).
- Crop mode setting (`pad` vs `crop`) applied per project across all scenes.
- Render presets (`long-form` / `short` / `square`) via `RENDER_PRESETS`, exposed through `GET /api/render-presets`.
- Short-format highlight selection: scenes flagged `includeInShort` are used preferentially for Short renders.
- Full `_runRender` rewrite: per-scene render (captions + overlays + crop burned in) → concat (cut or crossfade) → music mix → finalize, with per-scene warnings surfaced on the job instead of silent failure.
- Full Production Studio UI rewrite: per-scene footage/voiceover attach, caption preview/toggle/regenerate, overlay add/remove, Include-in-Short checkbox, new Mix tab (music + transitions + crop), preset selector on Render tab.

### Fixed (found via live end-to-end testing, not just code review)

- Upload race condition: `fs.stat()` could run before the write stream finished flushing, producing `size: 0` on uploaded assets. Fixed by awaiting the write stream's `finish` event before resolving the upload.
- Media-type misdetection when a client sends a generic/missing MIME type (e.g. some audio exports) — added an extension-based fallback.
- Caption timing broke when `scene.duration` (a display string like `"0:00–0:10"`) was reused as a numeric duration — resolved by introducing the separate `scene.durationSeconds` field everywhere the render engine needs a number.

### Verified

Full pipeline tested end-to-end against a live server: uploaded synthetic footage/voiceover/music via the real HTTP multipart endpoint, triggered both `long-form` and `short` render jobs, confirmed output files at correct resolutions (1920×1080 and 1080×1920), and visually confirmed burned-in title overlay and captions on an extracted frame.

### Known simplifications

- Captions are timed by proportional word-count split, not real speech-to-text alignment.
- Music "ducking" is constant attenuation, not sidechain compression.
- One footage + one voiceover clip per scene; no in-scene multi-asset compositing.
- V5's Flow-prompt asset requirements are not yet wired into the V8 render path.

### Next

V9 candidates (not yet scoped): real forced-alignment captions, true sidechain ducking, multi-asset scene compositing, inline render preview player.

## 2026-08-16 — Pre-V8 refactor

### Changed

- Split the monolithic 1,059-line `app.js` into six ES modules (`js/core.js`, `js/ui.js`, `js/research.js`, `js/script.js`, `js/production.js`, `js/app.js`) with a single entry point owning all event binding.
- Removed the V6/V7 `renderStories` monkey-patch; Production Studio's entry point is now part of the normal story-card template.
- Added try/catch error boundaries to async event handlers that previously had none.
- `GET /api/health` now reports the detected FFmpeg version string.
- Projects moved from browser-only `localStorage` to full backend persistence (`GET/POST/PATCH/DELETE /api/projects`).
- Added the V7 upload and render routes that the frontend was already calling but the backend didn't yet implement (`POST /api/stories/:id/production/upload`, `POST`/`GET /api/stories/:id/render`, `/media/uploads/`, `/media/renders/`).
- Fixed the stale `V2` title tag.

## 2026-08-16 — V7 Media Engine Foundation

### Added

- Multipart file upload.
- Per-story media folders.
- Server-side asset metadata.
- Media serving.
- Render jobs.
- Render-job persistence.
- FFmpeg availability check.
- Long-form MP4 render path.
- 9:16 Short render path.
- Render output serving.
- Render job status display.

### Rendering approach

V7 uses a deliberately conservative renderer:

video assets assigned to scenes are concatenated in scene order and normalized to the target canvas.

This proves the end-to-end media path before introducing complex timing and audio processing.

### Next

V8 — Content-aware editor:
- voiceover
- captions
- music
- overlays
- transitions
- intelligent timing
- Short extraction
