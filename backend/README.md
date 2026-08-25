# Backend

## Run

```bash
npm install
npm start
```

To enable Autopilot (see below), start with your `.env` loaded instead:

```bash
node --env-file=.env server.js
```

## Requirements

Node.js and FFmpeg must be installed.

Check:

```text
GET /api/health
```

The result includes:

```json
{
  "ffmpeg": true
}
```

## Autopilot setup (optional)

Autopilot fills in anything missing on a story — script, per-scene voiceover,
per-scene stock footage — then renders, all from one click in Production
Studio's Timeline tab. It never overwrites footage/voiceover you've already
attached yourself.

Voiceover needs no setup at all — it runs on Microsoft Edge's TTS service
(no API key, no billing account). Stock footage needs one free key:

1. Copy `.env.example` to `.env`.
2. Fill in `PEXELS_API_KEY` (free, no card required — https://www.pexels.com/api/).
3. Start the server with `node --env-file=.env server.js` instead of
   `npm start` so the key is loaded.

Without `PEXELS_API_KEY` set, Autopilot still runs — it'll write the script,
generate voiceover, and attempt the render, but scenes with no footage of
their own will show up as warnings on the job instead of silently failing.

Note on voiceover: it goes through the `@travisvn/edge-tts` package, which
talks to an unofficial, unpublished Microsoft endpoint (the same one behind
Edge's built-in "Read Aloud"). It's free and has been reliable in practice,
but — unlike a published API — Microsoft could change that endpoint without
notice. If narration generation ever starts failing across the board, that's
the first thing to check; swapping in a different TTS provider only means
changing the body of `synthesizeVoiceover()` in `server.js`.

## Media endpoints

Uploads:

`POST /api/stories/:id/production/upload`

Render:

`POST /api/stories/:id/render`

`GET /api/stories/:id/render`

Autopilot:

`POST /api/stories/:id/autopilot` — kicks off the full hands-off pipeline (requires an approved angle first)

`GET /api/stories/:id/autopilot` — poll job status/stage/warnings

Per-scene auto-fill (used internally by Autopilot, also callable directly):

`POST /api/stories/:id/script/scenes/:sceneId/voiceover/auto`

`POST /api/stories/:id/script/scenes/:sceneId/visual/auto`

Media is served from:

`/media/uploads/...`

`/media/renders/...`

## Notes

The V7 renderer is intentionally simple. It is proving the asset-storage → render-job → MP4-output pipeline.

A future renderer will use a richer scene timeline and audio graph.
