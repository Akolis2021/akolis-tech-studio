# V3 — Real Feed Backend

**Date:** 2026-08-16

## Objective

Replace the static Story Radar with real server-side RSS/Atom ingestion.

## Implemented

- Node.js native HTTP server.
- rss-parser.
- JSON persistence.
- Source CRUD.
- Story retrieval.
- Feed refresh.
- Server-side normalization.
- Duplicate prevention.
- Topic inference and scoring.
- Frontend API integration.
- Browser local cache fallback.

## API

GET `/api/health`

GET `/api/sources`

POST `/api/sources`

PATCH `/api/sources/:id`

DELETE `/api/sources/:id`

GET `/api/stories`

POST `/api/feeds/refresh`

## Why a backend is now required

RSS feed servers do not all permit arbitrary browser-side requests. Fetching feeds server-side avoids making the core ingestion workflow dependent on browser CORS behavior.

## Not implemented

- AI research
- citations
- source comparison
- media
- FFmpeg
- Flow automation
- YouTube API

## Next

V4 Research Studio. Preserve the vanilla frontend and keep API secrets server-side.
