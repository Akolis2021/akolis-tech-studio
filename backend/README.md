# Backend — V7

## Run

```bash
npm install
npm start
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

## Media endpoints

Uploads:

`POST /api/stories/:id/production/upload`

Render:

`POST /api/stories/:id/render`

`GET /api/stories/:id/render`

Media is served from:

`/media/uploads/...`

`/media/renders/...`

## Notes

The V7 renderer is intentionally simple. It is proving the asset-storage → render-job → MP4-output pipeline.

A future renderer will use a richer scene timeline and audio graph.
