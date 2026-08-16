# V4 — Research Studio

**Date:** 2026-08-16

## Objective

Turn an interesting story into an evidence-aware research package before writing a script.

## Implemented

### Research brief

- What happened
- Why it matters
- Developer impact
- Limitations/caveats

### Sources

A story can have multiple research sources.

Each source has:

- URL
- role
- title
- timestamp

Roles:

- primary
- secondary
- reference

### Claims

A story can hold factual claims with:

- confidence
- optional source IDs
- creation timestamp

### Angles

The system can generate several editorial angles.

The user can select one and save it as the approved angle.

## Important product decision

The story is not converted straight to a video.

It now follows:

Discovery → Research → Evidence → Angle → Script.

This is intended to reduce generic article summaries and make the final content more original and defensible.

## AI strategy

The API endpoint exists, but V4 uses a provider-agnostic fallback.

A real provider adapter comes later.

No API key is stored in the browser.

## Next

V5 — Script Studio.

Input:
- story
- research brief
- sources
- claims
- approved angle

Output:
- title options
- hook
- script
- scenes
- Flow prompts
- screen-recording requirements
- estimated duration
