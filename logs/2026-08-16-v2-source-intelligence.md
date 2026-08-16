# V2 — Source Intelligence Foundation

**Date:** 2026-08-16

## Objective

Move the prototype from a static demo story list to a structured story/source intelligence layer.

## Implemented

### Story data

Each story now has:

- id
- title
- source
- url
- publishedAt
- topic
- summary
- angle
- score
- status
- fingerprint
- importedAt

### Sources

The dashboard now has a Source Manager with:

- source name
- feed URL
- source type
- default topic
- active/paused state
- delete action

### Deduplication

A simple normalized title/source fingerprint prevents duplicate imported items from being stored.

This is intentionally basic. Later versions can use canonical URLs, GUIDs and stronger similarity checks.

### RSS/Atom

A browser-side XML parser is implemented and exposed as:

`window.AkolisStudio.importFeedXML(xmlString, sourceId)`

This allows parser testing before the backend exists.

### UI

Added:

- Story status filter
- Story detail modal
- Research state
- Project creation from story
- Source manager

## Important limitation

Direct browser requests to arbitrary RSS feeds should not be relied upon because many feed servers do not allow cross-origin requests.

Therefore the next step is a tiny backend that fetches feeds server-side.

## Deliberately not done

- AI research
- API keys
- remote database
- media uploads
- FFmpeg
- Google Flow automation
- YouTube API

## Next step

Build V3 backend:

1. Node.js server
2. Feed fetcher
3. XML parser
4. story normalizer
5. deduplication
6. JSON API consumed by `app.js`

Keep the frontend vanilla JS.
