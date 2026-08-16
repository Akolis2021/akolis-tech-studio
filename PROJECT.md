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

## V7 status

Implemented:

- V6 production planning.
- Actual multipart binary asset upload.
- Per-story upload folder.
- Asset metadata persistence.
- Asset scene/requirement assignment at upload.
- `/media/uploads/...` media serving.
- Render job creation.
- Render job status.
- FFmpeg availability detection.
- Long-form render job.
- Short render option.
- `/media/renders/...` output serving.
- Render job persistence.

## V7 render scope

The first renderer is intentionally conservative:

- takes uploaded video assets assigned to scenes
- concatenates them in scene order
- scales/pads to target output size
- encodes H.264 MP4

Long-form:
- 1920x1080

Short:
- 1080x1920

This is not yet the final editor.

Not yet implemented:

- voiceover synchronization
- captions
- music mixing
- scene transitions
- text overlays
- automatic Flow footage generation
- intelligent scene trimming
- AI-selected clip timing

Those belong in later media-engine milestones.

## FFmpeg requirement

The machine running the backend must have `ffmpeg` available on PATH.

`GET /api/health` reports whether FFmpeg is detected.

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

`backend/renders/`

These folders are ignored by git.

## Next milestone — V8 Editor

V8 should make the render genuinely content-aware:

1. voiceover upload
2. automatic narration duration
3. scene timing
4. background music
5. captions
6. title/lower-third overlays
7. transitions
8. aspect-ratio-aware cropping
9. Short highlight selection
10. render presets

## AI collaboration rule

Always read:

1. PROJECT.md
2. CHANGELOG.md
3. logs/README.md
4. latest relevant log

After meaningful changes, update CHANGELOG.md and create a dated log.
