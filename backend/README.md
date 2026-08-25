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

1. Copy `.env.example` to `.env`.
2. Fill in `GOOGLE_TTS_API_KEY` (Google Cloud Text-to-Speech — has a
   recurring monthly free tier, see `.env.example` for details) and
   `PEXELS_API_KEY` (free, no card required).
3. Start the server with `node --env-file=.env server.js` instead of
   `npm start` so the keys are loaded.

Without either key set, Autopilot still runs — it'll write the script and
attempt the render, but scenes missing voiceover/footage will show up as
warnings on the job instead of silently failing.

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
