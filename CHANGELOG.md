# Changelog

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
