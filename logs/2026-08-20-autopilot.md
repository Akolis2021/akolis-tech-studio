# 2026-08-20 — Autopilot (hands-off script → voiceover → visuals → render)

## Objective
User wants a one-click "hands-off" path: pick a story, and have script,
voiceover, visuals, and a rendered video ready to preview — with posting
still a manual step.

## Files changed
- `backend/server.js`
- `backend/.env.example` (new)
- `backend/README.md`
- `index.html`
- `js/production.js`
- `js/app.js`
- `styles.css`

## What was implemented
1. **`registerProductionAsset()`** — extracted the asset-registration logic
   (duration probing, scene-timing/caption side effects, music-mix side
   effects) that previously lived only inside the manual upload route into
   a shared function, so both manual uploads and the new auto-fill paths
   go through identical logic. No behavior change for manual uploads.
2. **`synthesizeVoiceover(text, destPath)`** — calls the Google Cloud
   Text-to-Speech REST API (`GOOGLE_TTS_API_KEY`, voice configurable via
   `GOOGLE_TTS_VOICE`, defaults to `en-US-Neural2-D`). Scripts are well
   under the 5,000-byte per-request limit, so no chunking needed at this
   app's scale.
3. **`fetchStockFootage(query, destPath)`** — searches Pexels Videos
   (`PEXELS_API_KEY`) by a query built from the scene's on-screen text /
   title, picks the largest MP4 up to 1920px wide, downloads it.
4. **Per-scene auto endpoints** (also usable standalone, not just via
   Autopilot):
   - `POST /api/stories/:id/script/scenes/:sceneId/voiceover/auto`
   - `POST /api/stories/:id/script/scenes/:sceneId/visual/auto`
5. **`runAutopilot(jobId)`** — the orchestrator. Sequence: verify an
   approved angle exists (hard requirement — Autopilot refuses to run
   without one, see rationale below) → generate script/scenes if missing →
   for each scene missing a voiceover asset, synthesize one → for each
   scene missing a footage asset, fetch stock footage → queue a long-form
   render job via the existing `_runRender` → mark the autopilot job
   done/error once the render finishes. Scenes that already have
   creator-uploaded footage/voiceover are left untouched. Per-scene
   failures (e.g. no stock match, TTS quota) are collected as warnings on
   the job rather than aborting the whole run.
6. **`POST` / `GET /api/stories/:id/autopilot`** — start and poll an
   autopilot job. Jobs are tracked in a new `store.autopilotJobs` array,
   same pattern as `renderJobs`.
7. **Frontend**: an "✨ Run Autopilot" button at the top of Production
   Studio's Timeline tab, with a live status box (stage, warnings, errors)
   polled every 3s alongside the existing render-job poller. On completion
   the Render tab now shows an inline `<video>` preview player for the
   most recent finished render (previously only a bare "Open rendered
   video" link existed).
8. Fixed a latent CSS bug found while touching this area: `.job-status`
   had rules for `.completed`/`.failed`, but the backend has only ever
   emitted `"done"`/`"error"` — those styles never matched anything.

## What was intentionally not implemented
- **No auto-selection of which story to run.** The user picks the story;
  Autopilot doesn't scan and pick "today's story" on its own.
- **Approved angle is a hard gate, not a suggestion.** Autopilot returns
  400 and refuses to start without one. This preserves the one piece of
  human editorial judgment (why this matters, developer impact) that
  keeps AI-assisted content on the right side of YouTube's 2026
  "inauthentic content" monetization policy — see the product conversation
  in this session's transcript for sourcing. Everything downstream of the
  angle is fine to automate; the angle itself is not.
- **Publish is still manual.** Autopilot's last step is rendering, not
  posting. No YouTube upload integration yet — flagged as a likely next
  step once the user has used Autopilot enough to trust the output.
- **No retry/backoff on TTS or Pexels calls.** A single failure per scene
  is recorded as a warning and the pipeline moves on; the user can retry
  an individual scene via the per-scene `/auto` endpoints without rerunning
  the whole story.
- **No .env loading built into `npm start`.** Node's built-in
  `--env-file` flag is used instead of adding a `dotenv` dependency;
  documented in `backend/README.md`. `npm start` (no env file) still works
  for everything except Autopilot's TTS/stock-footage steps.

## Bugs/issues found (not yet fixed)
- (carried over from 2026-08-20-workflow-clarity-pass.md) Projects panel
  progress % still doesn't sync with real story progress — Autopilot makes
  this more visible since a story can now go from "New" to "rendered" in
  one action while its Project card (if one exists) sits frozen at 5%.

## Decisions made
- Kept Autopilot entirely inside Production Studio rather than adding it
  to the dashboard story cards, since it operates on a specific story's
  scenes/assets and needs the same context Production Studio already
  loads.
- Chose Pexels over an AI video-generation API for the visuals gap,
  per explicit user preference (free, fast, no per-clip generation cost —
  trade-off is generic-looking b-roll rather than a custom "produced"
  look). Revisit if the channel's visual style needs to change later.

## Next step
YouTube Data API upload integration (`videos.insert`) as the final manual
"Publish" action once Autopilot output is trusted enough to ship straight
from the preview player — quota is a non-issue at one video/day, and since
this is a personal single-channel use case no Google app-review is needed,
just OAuth self-authorization.
