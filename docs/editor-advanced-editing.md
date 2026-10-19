# Advanced editor controls

The native media library supports these controls:

- Move the pointer horizontally over a video card to inspect its source frames. Requests are coalesced every 100 ms, with one active card per library. Leaving the card, starting a drag, changing projects or unmounting cancels pending sampling. Existing bounded preview resources own decoding and caching.
- Adjust thumbnail size from 80 to 240 CSS pixels. The setting is a persisted editor view preference.
- Browse all media, ungrouped media or one folder. Create folders and subfolders, rename them, or dissolve a folder. Dissolving moves its immediate children and media to its parent; it does not delete source media. Select media and choose a destination to move the selection in one native operation. Folder state belongs to the project and follows its save, reopen and undo behavior. An engine without native folder support exposes a disabled editing state; there is no local storage fallback.

Selecting multiple timeline clips shows their types and common numeric properties: position, scale, rotation, opacity and volume, according to the selected types. Different values display an empty field with a mixed-value hint. Enter or leaving the field commits one batch through the existing timeline transaction; unrelated parameters remain intact. Fields with animation channels and selections containing locked tracks are disabled.

The timeline toolbar offers compact, standard, large and extra-large track heights. This preference is scoped to the editor session store and persisted as view state. Track labels, clip geometry, selection intersections, drag targets and drop indicators use the same scale; expanded keyframe lanes retain their original height.

Implementation entry points:

- `components/editor/panels/assets/views/media-folders.tsx`: folder navigation and native operation controls.
- `components/editor/panels/assets/views/use-hover-scrub.ts`: bounded hover request scheduling.
- `components/editor/panels/properties/common-properties.tsx` and `common-property-edit.ts`: common fields and guarded batch patches.
- `timeline/components/track-layout.ts`: shared track geometry, consumed by rendering and interaction controllers.

Source fixtures cover sampling bounds and cancellation, track geometry, guarded batch patches and folder control operations. Installed application behavior and native engine availability require separate runtime acceptance.

Editor-owned presentation follows the live Host locale through `EditorLocaleProvider` and `useEditorMessages`, including focus tabs, export options, fit controls and the advanced-editing controls above. Changing language does not replace the project session or its save state. The header uses intrinsic height when wrapping; the project name can shrink, while the export action stays on one line. Component regressions cover both locale directions and these layout constraints; actual narrow-window geometry still requires installed runtime acceptance.
