# Akolis Tech Studio

## Purpose

A personal faceless-tech YouTube content intelligence and production system.

Workflow:

DISCOVER → RESEARCH → ANGLE → SCRIPT → SCENES → ASSETS → ASSEMBLY → REVIEW → REPURPOSE → PUBLISH

TechCrunch is a discovery source, not the content itself.

## User preference

Keep the project understandable:

- HTML
- CSS
- Vanilla JavaScript
- Plain Node.js

## Current stack

Frontend:
- HTML/CSS/Vanilla JS

Backend:
- Node.js native HTTP server
- rss-parser
- busboy
- JSON persistence
- FFmpeg command-line integration

## V8 status

Implemented and verified end-to-end (real render, real output file, inspected with ffprobe/ffmpeg):

- Role-based asset uploads: `footage`, `voiceover`, `music` (each tagged on upload via a `role` field).
- Automatic media-type detection with a file-extension fallback for when the client sends a generic MIME type.
- Automatic duration probing (`ffprobe`) on audio/video uploads.
- Voiceover-driven scene timing: attaching a voiceover to a scene sets `scene.durationSeconds` from the clip's real length. This is a **separate field** from `scene.duration`, which stays the free-text display string used by earlier UI (e.g. `"0:00–0:10"`) — don't conflate the two.
- Auto-generated captions on voiceover attach: narration text is split into ~7-word chunks and timed proportionally across `durationSeconds`. This is a simple proportional model, not real forced alignment — timing is approximate but close enough to be usable, and fully editable/regeneratable afterward (`POST /api/stories/:id/script/scenes/:sceneId/captions/generate`).
- Title and lower-third text overlays per scene, each with its own `[start, end]` window, burned in via `drawtext`.
- Scene transitions: hard cut (concat demuxer) or crossfade (`xfade`/`acrossfade`, configurable duration).
- Background music: looped/trimmed to the final video length, mixed at a configurable volume under the voiceover (constant attenuation, not true sidechain ducking — see "Known simplifications" below).
- Crop mode: `pad` (letterbox, keeps full frame) or `crop` (fill frame, may crop edges) — set per project, applied to every scene.
- Render presets: `long-form` (1920×1080), `short` (1080×1920), `square` (1080×1080). `GET /api/render-presets` exposes them to the frontend.
- Short highlight selection: scenes can be flagged `includeInShort`; a Short-preset render uses only flagged scenes if any exist, otherwise falls back to the full scene list.
- Render job warnings: scenes missing footage are skipped with a warning surfaced in the job status rather than silently failing the whole render; scenes missing voiceover render with a fallback duration and silent audio.

Full Production Studio UI: per-scene footage/voiceover attach buttons, caption preview + regenerate + enable toggle, overlay add/remove, Include-in-Short checkbox, a dedicated Mix tab (music upload + volume + transition + crop mode), and a render-preset selector on the Render tab.

## Known simplifications (intentional, for a later pass if needed)

- **Captions are not ASR-aligned.** They're the scripted narration text split evenly by word count across the voiceover's real duration. If the voice reads unevenly (long pauses, etc.), caption timing will drift from the actual speech. Good enough for a first pass; real alignment would need a speech-to-text step.
- **Music "ducking" is a constant volume reduction**, not real sidechain compression against the voiceover. It doesn't dynamically dip lower only when someone's speaking.
- **One footage clip and one voiceover clip per scene, no B-roll layering within a scene.** Multiple assets per scene aren't composited together yet.
- **Scene-level asset requirements from V5's script generation (Flow prompts) are separate from V8's direct footage/voiceover attach flow.** Both exist in the data model; V8 didn't wire Flow-prompt-driven asset requirements into the render pipeline, only direct scene attach.

## FFmpeg requirement

The machine running the backend must have `ffmpeg` and `ffprobe` available on PATH.

`GET /api/health` reports the detected FFmpeg version.

## Run

```bash
cd backend
npm install
npm start
```

Then open:

`http://localhost:3000`

## Important storage note

Uploaded files are stored under:

`backend/uploads/<story-id>/`

Rendered files are stored under:

`backend/renders/<story-id>/`

Intermediate per-scene render files during a render job live under `backend/tmp/<job-id>/` and are deleted after the job completes.

These folders are ignored by git.

## Next milestone — V9 (not yet scoped)

Candidates, not committed to:

- Real forced-alignment captions (speech-to-text timestamped)
- True sidechain music ducking
- Multi-asset compositing within a single scene
- Wire V5's Flow-prompt asset requirements into the V8 render pipeline
- Render preview player inline in Production Studio (rather than only a download link)

## AI collaboration rule

Always read:

1. PROJECT.md
2. CHANGELOG.md
3. logs/README.md
4. latest relevant log

After meaningful changes, update CHANGELOG.md and create a dated log.
