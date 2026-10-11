# Programmatic recipe inspector

Select a recipe-backed graphic clip and open **Programmatic source** in the
Classic inspector. The structured controls and **Recipe JSON (advanced)** edit
the same retained draft. Nothing is saved until **Apply** succeeds; **Discard**
loads the current source. Apply uses the existing Rust transaction and undo/redo
history, preserving the clip, declared resources and source provenance.

## Scene transitions

Existing Peel and Bend recipe transition nodes expose their authored style
parameters. These controls edit `scene.style`; they do not change the `from`/`to`
references, span, easing, node ID or transition type. Missing fields are not filled
from suggestions. Unknown transition styles remain editable through advanced JSON.
These are distinct from adjacent timeline clips' native transition controls.

## Layered finishing

Existing `post[]` effects expose parameters from the Rust finishing catalog:
grade, palette, vignette, grain, line boil, glitch, chromatic aberration, zoom blur,
bloom, light leak, invert, flash, fade, letterbox and quantization dither.
Post stage, roles, effect order and audio bindings are preserved.

For an amount-bearing effect, explicitly fill **Frame**, **Value** and **Easing**,
then choose **Add amount curve**. Existing curves support adding/removing keys,
editing each key and removing the curve. Grade and palette do not have an amount
curve. There is at most one curve per effect, bound to its zero-based effect index.

Keyframe frames are integer outer source frames in `[0, source.durationFrames]`;
the duration endpoint is allowed. Clip trim advances this source clock. Child
references and drawing-frame quantization do not change it. Keys must remain in
strictly increasing order, and values must be within the effect's published
amount bounds. Controls do not sort, clamp, infer beats or insert defaults.
Curve amounts are evaluated before any existing reviewed audio response.

Creating new scene nodes, post groups/effects, or audio bindings remains an
advanced JSON/agent authoring operation. Invalid or unsupported fields are retained
in JSON, not silently repaired. Rust performs final admission on Apply.

## Conflicts and validation

Structured controls are disabled while Apply is pending, the source is read-only,
or another operation has changed the source outside the draft. Conflicting drafts
are retained for copying; Discard loads the new source before further editing.
Invalid JSON, unsupported metadata and invalid curves never trigger an automatic
transaction. A rejected Apply does not publish a partial source or add history.

The public catalog is available as `getMvRecipeCatalog().finishing`.
`effects[kind].parameters` describes parameter types and bounds;
`automation.targetParameter` and `automation.targetEffects` describe supported
curve targets. Budget and easing metadata are also supplied by Rust. An older
catalog without explicit target metadata does not enable new curve creation.
