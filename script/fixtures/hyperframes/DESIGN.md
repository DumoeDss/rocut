# Diagnostic composition

This is a pixel oracle for the native HyperFrames adapter, not a finished video.
The 64 x 64 canvas is transparent. Pure red (#ff0000, alpha 0.5) identifies the
parent subcomposition, green (#00ff00) the nested child, and blue (#0000ff) the
root timeline. Geometry moves horizontally with linear easing for exact probes.
There is no visible text, decorative texture or remote asset. A white image
patch at (48,48) proves local PNG inlining. Its adjacent green patch proves the
declared local IBM Plex Mono font loaded and produced equal narrow/wide glyph
metrics; red there means fallback. Font bytes retain the repository asset license.

Deliberate hard visibility boundaries test the upstream `data-start` / duration
semantics. Do not add aesthetic fades or transitions to this diagnostic fixture.
