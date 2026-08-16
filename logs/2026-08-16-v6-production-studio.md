# V6 — Production Studio

**Date:** 2026-08-16

## Objective

Move from a script/scene plan into a production workspace where each scene can show required assets and track readiness.

## Implemented

- Production Studio modal.
- Timeline-like scene list.
- Required asset overview per scene.
- Local file selection / drag and drop.
- Asset metadata records.
- Requirement IDs.
- Scene IDs.
- Production readiness percentage.
- Render manifest.
- Manifest download.

## Deliberately not implemented

- actual binary upload
- cloud storage
- server file storage
- video decoding
- thumbnails
- FFmpeg
- audio mixing
- captions
- Shorts generation

## Architectural decision

The scene graph is now the contract between the content layer and media engine.

The media engine should not need to understand research or scripts. It only needs the approved scene graph and associated assets.

## Next

V7 — Media Engine.

Focus on:
- multipart file upload
- storage
- FFmpeg
- render jobs
- status polling
- MP4 output
- 9:16 Short rendering
