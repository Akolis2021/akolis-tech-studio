# 2026-08-20 — Workflow clarity pass

## Objective
User reported the app "technically works but the workflow is clunky/confusing."
No functional bugs reported — this pass targets navigation and legibility of
the Discover → Research → Script → Production pipeline, not new features.

## Files changed
- `index.html`
- `js/app.js`
- `js/research.js`
- `js/script.js`
- `js/production.js`
- `js/ui.js`
- `styles.css`
- `backend/server.js`

## What was implemented
1. **Forward navigation between studios.** Previously each studio (Research /
   Script / Production) was a dead-end modal — finishing a stage meant
   closing the modal, going back to the dashboard, and finding the right
   button on the story card to open the next one.
   - Research Studio's Angles tab now has a "Continue to Script Studio →"
     button, enabled once an angle is approved.
   - Script Studio's Overview tab now has a "Continue to Production Studio →"
     button, enabled once scenes exist.
   - Both close the current modal and open the next one directly on the same
     story — no manual re-navigation.

2. **Empty-state CTA in Production Studio.** If a story has no script scenes
   yet, the Timeline tab now shows a "Go to Script Studio →" button instead
   of just a dead-end text notice.

3. **Prerequisite notice in Script Studio.** If a story has no approved
   angle yet, the Overview tab now surfaces a notice explaining that before
   generating a script.

4. **At-a-glance stage hints on story cards.** The dashboard's Research /
   Script / Production buttons now each show a one-line status underneath
   (e.g. "✓ angle approved", "6 scenes", "0/6 scenes ready", "needs a script
   first") so users can tell where a story stands without opening every
   modal to check.

5. **Removed internal version numbers from user-facing UI.** Modal eyebrows
   read "V4 · RESEARCH STUDIO", "V5 · SCRIPT STUDIO", "V8 · MEDIA ENGINE",
   and the page title was "Akolis Tech Studio — V8" — these were internal
   build/iteration labels (see CHANGELOG.md) leaking into the product. They
   now read "RESEARCH STUDIO", "SCRIPT STUDIO", "PRODUCTION STUDIO". Fixed a
   matching stale "V4" string in the backend startup log
   (`backend/server.js`).

## What was intentionally not implemented
- Buttons on the story card (Research/Script/Production) are still always
  clickable regardless of stage — they were NOT disabled/gated. Advanced
  users who want to jump around or re-edit an earlier stage out of order can
  still do so; the new empty-state/prerequisite notices handle the confusing
  case without removing that flexibility.
- The Projects panel still tracks its own separate `progress`/`status` field
  that does not sync with story.research/script/production progress. This is
  a real second source of truth on the dashboard and is worth resolving, but
  is a bigger structural change than this pass covered — flagged for a
  future session.
- The "manual" source type has no feed-refresh handling in the backend
  (adding a manual source currently does nothing on refresh). Not touched
  this session — flagged as a gap.

## Bugs/issues found (not yet fixed)
- Manual source type is a dead option in Source Manager (see above).
- Project progress % is static after creation (stuck at whatever it was set
  to on creation) and never reflects actual story progress.

## Decisions made
- Chose non-blocking guidance (empty states + hints) over disabling buttons,
  to avoid breaking flexibility for users editing stages out of order.
- Kept the internal V-numbering scheme in CHANGELOG.md and code comments
  (useful for dev history) but removed it from anything rendered to the end
  user.

## Next step
Decide whether to unify Projects with story progress (single source of
truth), or treat Projects as a separate lightweight index and just stop
double-tracking progress on it.
