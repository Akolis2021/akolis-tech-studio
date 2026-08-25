# 2026-08-21 — Swap voiceover provider to Edge TTS

## Objective
User got stuck setting up Google Cloud billing (required to activate Cloud
TTS even within its free tier) and needed an unblocked path to keep testing
Autopilot without waiting on that.

## Files changed
- `backend/server.js`
- `backend/package.json`
- `backend/.env.example`
- `backend/README.md`
- `CHANGELOG.md`

## What was implemented
Replaced the Google Cloud TTS REST call inside `synthesizeVoiceover()` with
the `@travisvn/edge-tts` npm package, which talks to Microsoft Edge's online
TTS service. No API key, no billing account, nothing to sign up for. Same
function signature, same call sites (Autopilot and the per-scene
`/voiceover/auto` endpoint) — nothing else in the pipeline changed.

`EDGE_TTS_VOICE` env var replaces `GOOGLE_TTS_API_KEY`/`GOOGLE_TTS_VOICE`,
defaulting to `en-US-EmmaMultilingualNeural`.

## What was intentionally not implemented
- Did not build a pluggable multi-provider abstraction (e.g. `TTS_PROVIDER=
  google|edge`) to keep both options live side by side. Given the user
  explicitly asked to avoid complexity, this is a straight swap. Google TTS
  can be reinstated later by restoring the previous `synthesizeVoiceover()`
  body (see CHANGELOG.md 2026-08-20 entry / git history) if its higher
  reliability/SLA becomes worth the billing setup.

## Bugs/issues found (not yet fixed)
- None new. Carried-over items unchanged (see 2026-08-20 logs).

## Decisions made
- Chose `@travisvn/edge-tts` over alternatives (Azure free tier, ElevenLabs
  free tier, self-hosted Piper/Coqui) because it requires zero account setup
  of any kind — directly matches "unblock me right now" — at the cost of
  relying on an unofficial, unpublished Microsoft endpoint rather than a
  supported API. Documented that trade-off in `backend/README.md` so it's
  not a surprise if narration generation ever breaks across the board.
- Could not live-test the actual network round-trip to Microsoft's TTS
  endpoint from the sandbox this change was built in (its outbound network
  allowlist only covers package registries, not arbitrary API hosts).
  Verified instead: the package installs cleanly, its type definitions match
  exactly how `synthesizeVoiceover()` calls it, and the integration code
  follows the package's own documented usage pattern. This will make a real
  network call the first time it runs in the user's own environment.

## Next step
Once the user has generated a few real voiceovers this way, revisit whether
the default voice (`en-US-EmmaMultilingualNeural`) suits the channel's tone,
or whether to make voice selection a per-story setting in Script Studio
instead of a single global env var.
