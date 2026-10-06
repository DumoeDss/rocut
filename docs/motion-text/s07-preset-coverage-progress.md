# S07 preset coverage progress

Date: 2026-09-28

2026-10-06 font update: the current catalog retains 23 stable roles but now ships 20 digest-pinned assets and 25 asset entries, including both `gothic_bold_zh_hans` and `gothic_bold_ko`. The renderer advertises 896 IDs (889 JIZURA presets, five native aliases and two native font variants). Earlier 19-asset/895-ID observations below are historical. Korean form creation and actual installed multilingual export evidence are recorded in [the integration repair log](../elftia-integration-repair.md).

Status: in progress. The complete 912-entry JIZURA catalog is machine-classified and supported: 889 drawable presets plus 23 built-in font roles. Every drawable preset has native rocut support, runtime smoke, item-scoped Chromium pixel evidence, and a 720p cost measurement. This includes all 101 Batch B presets, the 55-preset three-file horror pack, all 49 backgrounds/cameras from `11p_bgcamB.js`, the complete 56-entry `11p_exit.js` family, all 51 holds/exits from `11p_exitB.js`, all 47 treatments/transitions from `11p_treattrans.js`, all 47 entrances from `11p_enterB.js`, all 40 entrances from `11p_enter.js`, all 115 entries from `07_decor.js`, `11p_decor.js`, and `11p_decorB.js`, all 87 treatments/backgrounds/cameras/effects from `11p_looks.js`, all 34 screen effects from `11p_fxB.js`, all 27 catalog styles, all 30 core animations, all 19 core layouts, all 123 layouts from `11p_layoutsA.js` through `11p_layoutsD.js`, and all eight built-in full-frame effects from `05b_registry.js`. The 23 font roles map to 19 digest-pinned offline TTF assets with matching OFL notices, declared language coverage, a real browser `FontFace` ready/release probe, and Vite package-closure evidence. Native JIZURA v1 project import is also complete: Rust owns schema validation, timing, preset resolution, locks, compatibility reporting, and fail-closed rejection; the editor imports through canonical WASM and inserts through the existing motion-text transaction. The editor now also exposes all 889 drawable presets through a searchable, group-filtered, row-virtualized browser with at most four active absolute-time canvas previews and verified scroll/tab/project cleanup. Catalog cards report renderer support, preview failures remain visibly unavailable, and font selectors display Rust-sourced supported/unsupported/unknown language coverage. Advanced cue/cut/preset-group/parameter locks, field-level inheritance controls, cross-style transition font/palette fidelity, and allowlisted Vite dev runtime-asset serving are complete and covered below. All seven generated catalog gates pass. G7/M2 remains open on the remaining source-family/product controls, comprehensive S09 evidence, and normal installed-WASM dependency sync.

## Catalog and support baseline

- The authoritative JIZURA inventory contains 912 entries: 889 presets and 23 font resources.
- The renderer currently advertises 895 IDs. Of these, 889 correspond to JIZURA catalog presets, five are rocut-native preset aliases absent from the JIZURA catalog, and one is the rocut-native zh-Hans font asset variant `font:gothic_bold_zh_hans`.
- Catalog status is 912 supported, zero pending, and zero `unsupported-with-reason` entries.
- The current report routing assigns 557 entries to A, 101 to B, 231 to C, zero to D, and 23 to `resource`; non-B/C presets move from D to A once support is advertised.
- Batch B contains 50 `typo` entries and 51 `kinetic` entries. All 101 Batch B entries are now supported with item-scoped Chromium preview evidence.
- The 39 earlier baseline entries also have item-scoped Chromium preview evidence: 5 styles, 7 layouts, 6 entrances, 7 holds, 7 exits, 5 treatments, 1 background, and 1 camera.
- The three completed Batch C horror slices contribute 55 supported entries: 3 styles, 12 layouts, 7 entrances, 4 holds, 7 exits, 7 decors, 4 treatments, 4 backgrounds, 2 cameras, 3 screen effects, and 2 transitions.
- The completed `11p_bgcamB.js` slice contributes 49 supported entries: 4 animated gradients, 15 repeating/geometric patterns, 10 scene backgrounds, 8 texture/effect backgrounds, and 12 frame-level cameras.
- The completed `11p_exit.js` source family contributes 56 supported entries: 20 holds and 36 exits. Five baseline recipes were already supported; this slice adds native behavior for the remaining 17 holds and 34 exits.
- The completed `11p_exitB.js` source family contributes 51 supported entries: 12 holds and 39 exits. Catalog hold and exit coverage are now complete at 52/52 and 109/109 respectively; renderer support manifest version 34 advertises all 51 only after behavior, Chromium, and cost evidence passed.
- The completed `11p_treattrans.js` source family contributes 47 supported entries: 27 treatments and 20 cut-to-cut transitions. Renderer support manifest version 35 closes catalog treatment and transition coverage at 62/62 and 27/27 respectively.
- The completed `11p_enterB.js` source family contributes 47 supported entrances across physics, paper/light, digital-device, and graphic-mask behaviors. Renderer support manifest version 36 raises catalog entrance coverage from 40/125 to 87/125.
- The completed `11p_enter.js` source family contributes 40 entrances. `slideL` and `slideR` were already baseline-supported; renderer support manifest version 37 adds the remaining 38 native recipes and closes catalog entrance coverage at 125/125.
- The completed `07_decor.js` source family contributes 15 supported entries: 6 decorations behind text and 9 decorations in front of text.
- The completed `11p_decor.js` source family contributes 45 supported entries: 9 decorations behind text and 36 decorations in front of text.
- The completed `11p_decorB.js` source family contributes 55 supported entries: 8 decorations behind text and 47 decorations in front of text. Catalog decor coverage is now complete at 130/130 supported and zero pending.
- The completed `11p_looks.js` source family contributes 87 entries: 24 treatments, 24 backgrounds, 15 cameras, and 24 screen effects. Four baseline treatments were already supported, so manifest version 33 adds 83 native implementations. Catalog background coverage is 66/66 and camera coverage is 36/36; the later `11p_treattrans.js` slice closes treatment coverage at 62/62.
- The completed `11p_fxB.js` source family contributes 34 screen effects. Renderer support manifest version 38 adds all 34 and closes catalog FX coverage at 69/69 supported.
- The catalog's core and extended style families are complete at 27/27 palettes. The latest slice adds 19 native palettes to the five baseline and three Horror styles.
- The core `05_anim.js` source family is complete at 30/30: 13 entrances, 6 holds, and 11 exits. Thirteen baseline recipes were already supported; the latest slice adds the remaining 17 native animations.
- The core `06_layouts.js` source family is complete at 19/19. Seven baseline layouts were already supported; the latest slice adds the remaining 12 native layouts.
- The extended `11p_layoutsA.js` source family is complete at 28/28 native layouts.
- The extended `11p_layoutsB.js` source family is complete at 27/27 native layouts.
- The extended `11p_layoutsC.js` source family is complete at 34/34 native layouts.
- The extended `11p_layoutsD.js` source family is complete at 34/34 native layouts, bringing catalog layout coverage to 186 supported and zero pending.
- All 11 preset groups that currently contain supported JIZURA entries have representative short/long, English/Chinese/Japanese/Korean, landscape/portrait, and overlay/scene Chromium matrix evidence.
- All 889 supported JIZURA presets have a 1280×720 Chromium cost tier derived from 30 measured frames after 5 warm-up frames.
- The 23 non-drawable font resources use `not-applicable` for preview, transparent mode, and frame cost; their support evidence is offline bytes, SHA-256, OFL notice, glyph coverage, ready-barrier lifecycle, and build closure.
- The six native-only entries remain explicitly recorded: `style:base`, `enter:fade`, `exit:fade`, `bg:transparent`, `cam:static`, and `font:gothic_bold_zh_hans`.

The generated compatibility report is `docs/motion-text/jizura-preset-compatibility.json`. `script/audit-motion-text-preset-coverage.ts` derives every catalog entry from the authoritative catalog and rejects duplicate IDs, unknown renderer support, stale native-only aliases, and report drift.

## Offline font resource slice

The 23 roles from `02_fonts.js` share 19 unique TTF files instead of duplicating Noto Sans JP and Noto Serif JP bytes per weight, and the `gothic_bold` role carries one additional language asset variant. The canonical mapping is `rust/crates/motion-text/resources/jizura-font-catalog.json`; it records role ID, family, style, weight, kind, supported languages, built-in URL, content SHA-256, upstream source file, and OFL path, plus the optional `roleId`/`defaultForLanguages` variant pair. New Rust-created sequences default to `gothic_bold`, carry all 23 built-in roles, resolve the role once from the sequence language, and persist the concrete asset ID into resolved cuts. The renderer resolves `builtinPath` before external project URLs, includes it in the cache identity, verifies the declared digest, checks missing glyphs, waits for the `FontFace` ready barrier, invalidates stale layout work, and releases the face when its resource generation is disposed.

The shipped source set is pinned to Google Fonts repository revision `23e54b51ddffbc7713c583748e3bd86f62b1fa4a`; the M PLUS Rounded 1c notice is additionally pinned to `coz-m/MPLUS_FONTS@eb604901d6f04b6f7f2a84b0378c58df84a9dba6`. The 19 TTFs total 117,455,080 bytes. Their 19 OFL notices total 83,981 bytes, so the Vite editor asset closure contains 38 font files and 117,539,061 bytes. The root SBOM summarizes this set; the exact per-family license text remains beside the font bytes under `motion-text/fonts/licenses/`.

Declared coverage is deliberately narrower than the original online JIZURA language mapping: 22 roles declare Japanese and English, `mono` declares English only, and the `gothic_bold` zh-Hans variant declares Chinese and English. `gothic_bold_zh_hans` (`noto-sans-sc-variable.ttf`, 17,772,300 bytes, SHA-256 `a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`) covers the shared F01 fixture with zero missing code points and is the only full-coverage asset. The remaining JIZURA Chinese/Korean family substitutions from `02b_lang.js` are still not packaged offline, so missing-glyph validation must block an uncertain export or require an explicit replacement; this slice does not claim general Chinese/Korean font fidelity merely because the drawable language matrix renders with environment fallback fonts.

## Typographic layout slices

The layout work was completed across three slices. The first slice added:

- `layout:tyBaseline`: left-aligned multiline typography with full-width baselines and an accent segment.
- `layout:tyFullTrack`: individual glyphs distributed across the full horizontal or portrait vertical extent, with a parallel rule.
- `layout:tyMargin`: compact edge-aligned typography, deliberately large negative space, a distant rule, and an accent marker.
- `layout:tySquare`: per-glyph square-grid composition with a deterministic accent glyph and visible grid rules.

The second slice adds:

- `layout:tyKeySplit`: one dominant key word or glyph flanked by smaller leading and trailing text.
- `layout:tyCropGiant`: a dim oversized copy cropped by a frame edge plus a readable foreground block.
- `layout:tyCross`: horizontal and vertical arms crossing at an accented key glyph.
- `layout:tyScaleSteps`: successive text units sharing one baseline while increasing in point size.
- `layout:tyJustify`: two to four independently sized rows forming a common visual width.
- `layout:tyIndexTable`: numbered glyph rows with Unicode labels and table rules.
- `layout:tyStatCount`: lyric block, divider, oversized character count, and statistical caption.
- `layout:tyLineFocus`: a focused word or glyph at full opacity with dim surrounding text and an accent bar.

The third slice completes the layout group:

- `layout:tyBandHide`: foreground lyric rows crossed by clipped accent bands carrying repeated moving captions.
- `layout:tyRuby`: tracked glyphs with kana romanization, kanji markers, and per-glyph indices.
- `layout:tySplitType`: two clipped copies offset on opposite sides of an accented horizontal cut.
- `layout:tyErode`: progressively longer prefix rows with distance-based opacity and glyph-count labels.
- `layout:tyVRuler`: vertical per-glyph composition with ruler line, major/minor ticks, indices, and a progress marker.
- `layout:tyRotBlock`: a transformed side label separated from a readable multiline main block.

The first slice lives in `typography-layouts.ts`; the second is isolated in `typography-editorial-layouts.ts`; and clipping/transform-heavy layouts live in `typography-graphic-layouts.ts`. They share the callback contract in `typography-layout-types.ts`. `draw.ts` supplies the existing treatment-aware text callback, resolved font, palette, and Canvas2D context. This keeps outline, outline-fill, underline, and glow behavior on the same renderer path while preventing the main draw switch from absorbing the typography pack.

These are native rocut drawing adapters, not embedded execution of JIZURA source. They preserve each preset's observable editorial geometry without introducing a second project model, player, timeline, or exporter.

## Typographic entrance slice

The entrance slice adds:

- `enter:tyKeyFirst`: isolates the key glyph first, then expands the remaining glyphs outward from that anchor.
- `enter:tyLineWipe`: reveals glyphs behind a left-to-right clip edge with a synchronized accent rule.
- `enter:tyZoomOne`: stages glyphs from an oversized shared center into their final positions.
- `enter:tyUnderLift`: grows an underline before glyphs rise vertically from it.
- `enter:tyDotGrow`: seeds positions with accent dots that expand into their final glyphs.
- `enter:tyBracketOpen`: opens a clipped center window between animated corner brackets.
- `enter:tyRetype`: performs a deterministic wrong-glyph, delete, and retype sequence with a cursor.
- `enter:tyRubyDrop`: drops small secondary-color ruby-like glyphs into full-size foreground positions.

`runtime.ts` now exposes normalized `enterProgress` and `exitProgress` independently from the generic opacity/transform result. `typography-entrances.ts` owns the eight glyph-level drawing strategies, while `draw.ts` routes both standard layouts and the typographic layout callbacks through the same entrance seam. The eight IDs bypass the generic fade fallback, and the wrapper stops intercepting drawing after the entrance settles so the normal complete layout is restored. All fixture sequences use `hold:still` and `cam:static`, isolating entrance pixels from unrelated hold or camera motion.

## Typographic hold slice

The hold slice completes the typographic hold group:

- `hold:tyKeyPulse`: scales only the selected key glyph on a smooth pulse while all other glyphs remain stable.
- `hold:tyReadCursor`: advances an accent-colored lifted reading cursor one glyph at a time, including deliberate blank steps at the end of a pass.
- `hold:tyOutlineBlink`: deterministically switches one or two glyphs to outline-only rendering during brief repeatable windows.
- `hold:tyTrackStep`: snaps letter spacing through four typographic tracking levels with a short eased transition between steps.

`typography-holds.ts` owns these glyph-level strategies and receives the same treatment-aware glyph callback used by layouts and entrances. Entrance drawing has priority until its transition is settled; the hold wrapper then animates from absolute `localTime`, so random seek and sequential playback resolve the same phase. Outline selection uses the cut seed rather than ambient randomness, and hold fixtures use `enter:cut` plus `cam:static` to isolate hold motion.

## Typographic exit slice

The exit slice completes the typographic exit group:

- `exit:tyStrike`: grows a strike rule while glyphs collapse vertically onto it, then retracts the rule.
- `exit:tyToDot`: shrinks ordered glyphs into accent middle dots before fading them out.
- `exit:tyLineFeed`: advances the line upward through a clipped window in three discrete eased steps.
- `exit:tyBracketClose`: closes an accent bracket window toward the center and takes the clipped line with it.
- `exit:tyToIndex`: replaces ordered glyphs with small secondary-color two-digit indices before fading.
- `exit:tyKeyLast`: folds non-key glyphs into the selected key glyph, which then swells and fades.
- `exit:tyUnderSink`: grows an underline while ordered glyphs sink through its clipping boundary, then retracts the line.
- `exit:tyFoldVert`: folds a horizontal line into a centered vertical column before drifting and fading.

`typography-exits.ts` owns the eight exit strategies. `runtime.ts` exposes the raw normalized exit phase and excludes these IDs from the generic opacity fallback; `draw.ts` gives specialized exit drawing priority over holds once the exit phase begins. The implementation remains absolute-time and seed-stable, and uses the existing treatment-aware glyph callback, Canvas clipping, scale, translation, palette, and transparent composition path.

## Typographic decor, treatment, and transition slices

The renderer support manifest reached version 10 when the typographic pack completed. `typography-decors.ts` completes the six typographic decorations:

- `decor:tyColophon`: a three-line corner colophon with lyric title, cut time, glyph count, and accent hairline.
- `decor:tyRunningHead`: an editorial running head, extending rule, bottom folio number, and accent marker.
- `decor:tyGlyphBody`: glyph-body edge guides, top/bottom body rules, and a compact specimen measurement label.
- `decor:tyTextRule`: clipped repeated lyric rules moving in opposite directions along the top and bottom edges.
- `decor:tyTypeScale`: the key glyph rendered at five descending sizes with numeric labels and a baseline rule.
- `decor:tyBigPunct`: oversized dim Japanese corner punctuation framing the lyric.

`typography-treatments.ts` completes the four typographic treatments at the final glyph seam:

- `treat:tyHollowKey`: one stable key glyph is outline-only among filled glyphs.
- `treat:tyHeadRules`: a heavy upper rule and hairline lower rule frame the text span.
- `treat:tyHeadBig`: the first readable glyph grows, rises, receives the accent color, and makes room for following glyphs.
- `treat:tyIndexSup`: every visible glyph receives a small accent superscript index.

`typography-transitions.ts` completes the two typographic transitions using both adjacent cuts, rather than decorating only the incoming cut:

- `trans:tyRuleWipe`: the previous cut remains visible while staggered horizontal bands reveal the current cut behind cursor bars and temporary ruled lines.
- `trans:tyGridCells`: the previous cut remains visible while manuscript-grid cells reveal the current cut in right-to-left vertical reading order.

`draw.ts` renders text content through callbacks that redraw the previous and current vector frames under transition masks. This avoids a second player or offscreen project model while preserving real A/B transition semantics. Runtime resolution now carries `previousFont` and `previousPalette` independently from the current cut, and the transition callback uses each adjacent cut's own resolved typography and colors. The cross-style fixture proves `BEFORE` uses `Resolved Previous` with `#aa1100`, while `AFTER` uses `Resolved Current` with `#0044cc`.

## Kinetic `11p_kinetic3.js` slice

Renderer support manifest version 11 adapted the first seven entries from JIZURA `11p_kinetic3.js` without executing the source pack:

- `decor:knSpeedTrail`: seed-stable speed lines follow the trailing side of the resolved text bounds, animate from absolute cut time, and switch axis for vertical text.
- `decor:knWordTicks`: a word-clock counter fills one segment per derived word onset and displays the current/total word count.
- `treat:knWordScale`: the longest seed-stable key word grows while the remaining words shrink, with the complete run normalized back into the available line width.
- `treat:knWordPlate`: alternating words are knocked out of solid foreground plates, including the source effect's optional deterministic tilt.
- `trans:knCornerSwing`: previous and current cuts rotate around one deterministic canvas corner in opposing quarter turns with an accent seam.
- `trans:knStutterCut`: previous and current cuts trade places at four hard timing thresholds with alternating reframe scale and offset.
- `trans:knStripSlam`: the previous cut remains below while three to five deterministic strips of the current cut drop or rise in sequence and settle with a short bounce.

`kinetic-words.ts` owns the bounded word segmentation and first-half cut clock shared by the word-aware effects. `kinetic-decors.ts`, `kinetic-treatments.ts`, and `kinetic-transitions.ts` remain renderer-only behavior modules; the existing typography dispatchers provide their final text, decor, and adjacent-cut seams. All randomness is derived from the cut seed, and every animated value is a pure function of `localTime` or normalized transition progress.

Renderer support manifest version 12 completes the source file with its six frame-level cameras:

- `cam:knReadPan`: the frame snaps through word-aligned horizontal reading positions, adds a short shear/blur whip, then settles toward center.
- `cam:knTiltKick`: each new word springs to the opposite dutch angle and the last word restores a level frame.
- `cam:knCardFlip`: independent X/Y scale enables a true horizontal or vertical card reveal, followed by short per-word pinches.
- `cam:knShearKick`: the frame receives an alternating decaying horizontal shear and coupled lateral kick at each word onset.
- `cam:knJumpCut`: each word selects a hard scale and off-center reframe with no interpolation, then returns to center after the word clock.
- `cam:knRushIn`: the complete frame accelerates from a distant blurred, rotated state through a small overshoot and settles.

`kinetic-cameras.ts` computes these platform-independent frame transforms from cut data, absolute local time, and the stable seed. `runtime.ts` composes them with existing enter/hold/exit transforms, while `draw.ts` applies independent axis scale and Canvas2D shear before drawing the vector content. The deterministic PRNG moved to `deterministic-random.ts` so camera evaluation and glyph/layout effects share one implementation without a renderer-runtime import cycle.

## Kinetic `11p_kinetic2.js` holds, entrances, and exits

Renderer support manifest version 13 adds all six word-aware holds from `11p_kinetic2.js`:

- `hold:knWordPulse`: one word at a time swells on a repeating beat clock, with the transform anchored at the word center.
- `hold:knCounterRock`: neighboring words rotate in opposing directions around their own centers.
- `hold:knWordRide`: a traveling sinusoidal swell lifts and tilts each word according to its place in the line.
- `hold:knTickShift`: the complete line snaps sideways with a small back-eased overshoot on the local beat clock.
- `hold:knBeatLean`: neighboring words receive alternating decaying shear kicks after each beat.
- `hold:knGapBreath`: word centers move away from and back toward the line center while each word's glyphs remain rigid.

`kinetic-holds.ts` owns approximate word geometry and rigid per-word transforms, reusing the final treatment-aware glyph callback. The hold dispatcher now starts immediately when the selected entrance is `cut`; animated entrances still retain priority until their normalized entrance phase settles. This prevents the first hold beat from being silently swallowed by a synthetic transition delay while preserving the existing entrance/hold ordering.

Renderer support manifest version 14 adds all ten word-aware entrances from the same source file:

- `enter:knWordSlam`: words land sequentially from oversized, oppositely rotated states and can knock earlier words on impact.
- `enter:knTypeToSlam`: each word types partially before snapping from a compact state to full size.
- `enter:knReplaceIn`: words occupy the center one at a time before the final line expands into place.
- `enter:knHingeDrop`: words rotate down around alternating word-edge hinges with a bounce landing.
- `enter:knLoopIn`: glyphs follow a curved loop path and rotate along its tangent before settling.
- `enter:knPushIn`: the visible word prefix is pushed into its final alignment in word-width steps.
- `enter:knInertia`: a direction-stable glyph train brakes with velocity-derived axis stretch and counter-squeeze.
- `enter:knWordSpin`: neighboring words spin in as rigid pieces in opposite directions.
- `enter:knDiveIn`: words arrive sequentially from an oversized, soft depth state and land sharp.
- `enter:knStretchOut`: each word extends elastically from its first glyph along the reading axis.

`kinetic-word-geometry.ts` provides stable word membership, glyph positions, word edges, and word centers. `kinetic-entrances.ts` owns the ten distinct arrival strategies and routes them through the existing treatment-aware glyph callback. The IDs bypass the generic fade fallback; no entrance is represented as a renamed common zoom or opacity curve.

Renderer support manifest version 15 completes `11p_kinetic2.js` with all eight word-aware exits:

- `exit:knWordKick`: words leave in staggered alternating vertical directions while tumbling around their centers.
- `exit:knPushOut`: the line advances in word-width steps and glyphs disappear as they cross its starting edge.
- `exit:knDiveGlyph`: the camera dives exponentially into a stable focus glyph while surrounding glyphs fly past and fade first.
- `exit:knLaunch`: the leading glyph pulls away first and the remainder follow as a stretched chain.
- `exit:knWordBlink`: one word at a time receives an accent-color punch before switching off.
- `exit:knCloseGap`: words are removed from alternating ends while the remaining words shrink and recenter.
- `exit:knJumpCutOut`: three hard scale, offset, and tilt states replace one another without interpolation before the line vanishes.
- `exit:knStackAway`: words hop into a centered tower, then the full tower tumbles below the frame.

`kinetic-exits.ts` owns these departures and reuses the shared word geometry. `typography-exits.ts` dispatches them before its typographic switch, while `runtime.ts` excludes all eight IDs from the generic exit fade. `11p_kinetic2.js` is now 24/24 supported: six holds, ten entrances, and eight exits.

## Kinetic `11p_kinetic1.js` layout slice

Renderer support manifest version 16 completes the 14 kinetic layouts:

- `layout:knSlamStack`: word units arrive as size-contrasted stacked rows, with alternating slam rotation and inter-row rules.
- `layout:knQuarterTurn`: word units form a right-angle staircase with alternating 90-degree turns and marked joints.
- `layout:knSwapCenter`: words replace one another at the composition center before resolving outward into the full line.
- `layout:knZoomDive`: the previous word expands around a focus glyph as the next word emerges from depth.
- `layout:knFlowSnap`: glyphs travel along a sinusoidal stream and snap into a ruled grid.
- `layout:knSeesaw`: word mass lands on a rotating plank above an accent fulcrum, including drop and landing squash.
- `layout:knTypeSlam`: a typed caption and cursor precede an oversized key-word impact with radial burst marks.
- `layout:knRhythmCuts`: successive words receive distinct shot compositions before resolving to a clean full-line shot.
- `layout:knPathRide`: glyphs ride and rotate around a visible loop rail.
- `layout:knGearWords`: adjacent word plates form counter-rotating toothed gears.
- `layout:knCollide`: two text halves accelerate from opposite sides, squash on contact, and emit speed or impact lines.
- `layout:knTumble`: boxed word units roll through multiple turns onto a shared floor rule.
- `layout:knReflow`: glyphs travel on alternating arcs from vertical columns into a horizontal reading line.
- `layout:knPadGrid`: words trigger individual grid pads with staged cell construction and decaying accent flashes.

`kinetic-layouts.ts` dispatches between `kinetic-stage-layouts.ts` and `kinetic-graphic-layouts.ts`; shared word segmentation, approximate sizing, row geometry, transformed text drawing, rules, easing, and seed-stable selection live in `kinetic-layout-utils.ts`. The renderer preserves layout-specific composition and motion rather than aliasing these IDs to `center`, `stack`, or one generic grid. Batch B is now 101/101, and the kinetic pack is 51/51.

## Horror `11p_horror1.js` foundation slice

Renderer support manifest version 17 starts Batch C with three horror palettes and all 12 layouts from JIZURA `11p_horror1.js`:

- Styles: `style:hrRuin`, `style:hrNightRec`, and `style:hrCurse` provide separate ruined-paper, night-recording, and cursed-red palette semantics.
- Found-footage layouts: `layout:hrFlashlight`, `layout:hrDoorGap`, `layout:hrWallScrawl`, `layout:hrCctv`, `layout:hrOuija`, and `layout:hrMissing` preserve their spotlight, gap, repeated-writing, surveillance-grid, spirit-board, and missing-poster compositions.
- Uncanny layouts: `layout:hrWrongOne`, `layout:hrRisingDark`, `layout:hrRedacted`, `layout:hrStaticTv`, `layout:hrSpiritPhoto`, and `layout:hrWrongShadow` preserve corrupt-glyph, rising-darkness, classified-record, CRT-static, annotated-photo, and mirrored-shadow signatures.

`horror-layouts.ts` dispatches into the found-footage and uncanny modules, while `horror-layout-utils.ts` owns deterministic text grouping, seeded selection, geometry, and drawing helpers. `typography-layouts.ts` invokes this adapter before the existing typographic and kinetic families. The layouts remain driven by absolute progress and the stable cut seed; rocut does not execute JIZURA source code.

The deterministic random helper now reapplies unsigned coercion after its final XOR. A regression test covers seeds -32 through 32 and salts 0 through 63, proving `unitRandom` stays in `[0, 1)` and `signedRandom` stays in `[-1, 1)`. This fixes negative pseudo-random values that previously distorted dates, stable choices, and motion. The two most expensive horror layouts also avoid filtered large-text drawing: the wall scrawl uses a bounded repeated-copy density, and the wrong shadow uses two translucent mirrored echoes. Their current 720p p95 costs are 12.1 ms and 18.8 ms respectively, below the 33.3 ms budget.

## Horror `11p_horror2.js` behavior slice

Renderer support manifest version 18 completes all 22 behavior presets from JIZURA `11p_horror2.js`:

- Entrances: `enter:hrBlinkCreep`, `enter:hrJumpScare`, `enter:hrUneasy`, `enter:hrVhold`, `enter:hrMirrorSnap`, `enter:hrManifest`, and `enter:hrClawReveal` retain staged blink convergence, snap zoom, irregular glyph timing, vertical sync roll, mirrored correction, wavering manifestation, and claw-band reveal semantics.
- Holds: `hold:hrTwitch`, `hold:hrStare`, `hold:hrLagOne`, and `hold:hrFlickerLight` retain rare jerk, selected-glyph stare, delayed-glyph sway, and deterministic failing-light behavior.
- Exits: `exit:hrPulledDown`, `exit:hrLookBack`, `exit:hrTurnAway`, `exit:hrShiver`, `exit:hrSwallow`, `exit:hrFlickerDie`, and `exit:hrDrain` retain staggered downward pull, one-glyph look-back, edge-on turn, growing tremor, spreading darkness, intermittent extinction, and clipped ink-drain behavior.
- Treatments: `treat:hrInkBleed`, `treat:hrEroded`, `treat:hrRedact`, and `treat:hrDoubleExp` retain bleeding halos/drips, background-colored pits/scratches, removable redaction bars, and an offset secondary exposure.

`horror-text-effect-utils.ts` owns deterministic glyph placement and transformed drawing. The four family modules dispatch before the existing kinetic and typographic adapters, while `runtime.ts` exempts the seven entrances and seven exits from generic opacity fallback so the specialized geometry remains authoritative. All behavior is recomputed from absolute local time and cut seed; no mutable playback state or JIZURA execution is introduced. Chromium fixtures isolate all 22 IDs on transparent overlays. Each entrance, hold, and exit changes across its two sampled phases with pairwise-distinct first-phase hashes; all four treatments are pairwise pixel-distinct. The deliberate off frame in `hrFlickerDie` remains part of the effect, while evidence samples use two visible exit frames.

## Horror `11p_horror3.js` environment slice

Renderer support manifest version 19 completes all 18 environment and full-frame presets from JIZURA `11p_horror3.js`:

- Decorations: `decor:hrScratches`, `decor:hrSigil`, `decor:hrWatchEye`, `decor:hrStaticPatch`, `decor:hrDustBeam`, `decor:hrDrips`, and `decor:hrCracks` retain claw gouges, a rotating heptagram, a blinking eye that tracks the text, edge static, a dusty light shaft, growing ink drips, and branching corner fractures.
- Backgrounds: `bg:hrFailingLamp`, `bg:hrCorridor`, `bg:hrMold`, and `bg:hrDeadTrees` retain deterministic lamp failure, moving perspective frames and side doors, edge-grown stain fields, and two-layer swaying dead trees.
- Cameras: `cam:hrNervous` and `cam:hrDutchSnap` retain mixed-frequency handheld motion with seeded flinches and a late cut-relative snap to a seeded dutch angle.
- Screen effects: `fx:hrSubliminal`, `fx:hrSignalLoss`, and `fx:hrPassingShadow` retain a short enlarged color-stained flash, tear/blackout/return phases with an explicit `NO SIGNAL` state, and a tall seeded figure crossing the full frame.
- Transitions: `trans:hrStaticCut` and `trans:hrBlink` retain old/new shot switching through deterministic static and closing/opening eyelid masks.

`horror-frame-utils.ts` owns shared bounds, easing, and rectangle-segment geometry; the decor renderer separates back-layer sigil/beam work from front-layer marks, the background renderer runs before camera-transformed text, and the screen-effect renderer runs after text and transitions in full-frame coordinates. `horror-cameras.ts` composes with the existing runtime transform fields, while `horror-transitions.ts` reuses the established two-cut callback seam. Static density is bounded to avoid per-pixel work. All five families use only absolute `localTime`, cut duration, and the stable cut seed; no mutable event scheduler or JIZURA runtime is introduced.

## Core `05b_registry.js` full-frame FX slice

Renderer support manifest version 20 adds all eight built-in JIZURA FX: `fx:chroma`, `fx:shake`, `fx:slice`, `fx:block`, `fx:invert`, `fx:flash`, `fx:zoom`, and `fx:mosaic`.

`screen-effects.ts` preserves the declared FX order while dispatching core and horror families. `core-screen-effects.ts` captures the current frame into source-canvas-scoped scratch surfaces and implements chromatic offset passes, deterministic shake, horizontal band displacement, relocated glitch blocks, alpha-guarded inversion and flash, layered zoom trails, and nearest-neighbor mosaic. Both `HTMLCanvasElement` and `OffscreenCanvas` render paths are supported. Pixel effects always derive their mask from the source frame, so transparent overlays remain transparent; `shake` composes with the existing content transform instead of shifting an opaque scene background and exposing clear edges. Scratch surfaces are only a render-resource cache: effect phase, offsets, blocks, and motion are recomputed from absolute `localTime`, effect order, and the stable cut seed.

The Chromium fixture isolates every core effect on a transparent overlay. All eight produce visible bounded pixels, change across the two sampled phases, and have pairwise-distinct first-phase hashes: `chroma:ea38f682→f9f3d86f`, `shake:124ad715→054c09b2`, `slice:cdc0bed8→a5edd7cc`, `block:880aa79f→11b197a3`, `invert:39d1c9df→42fd12e3`, `flash:d595075f→06686c39`, `zoom:9d74c78f→1cd4b108`, and `mosaic:3ae35bda→5b91a82e`. Each first-phase hash is byte-identical between the HTMLCanvas fixture and the production-style OffscreenCanvas path.

## Background/camera `11p_bgcamB.js` slice

Renderer support manifest version 21 completes all 49 entries from JIZURA `11p_bgcamB.js` without executing the source pack:

- Gradients: `bg:auroraRibbons`, `bg:meshBlobs`, `bg:duotoneSweep`, and `bg:horizonGlow` retain layered curtain motion, drifting color masses, a rotating two-color sweep, and a breathing planetary limb.
- Textile and geometric patterns: `bg:seigaiha`, `bg:asanoha`, `bg:houndstooth`, `bg:herringbone`, `bg:argyle`, `bg:tartan`, `bg:chevron`, `bg:isoCubes`, `bg:hexGrid`, `bg:triTess`, `bg:moire`, `bg:squareTunnel`, `bg:spiralArms`, `bg:topoLines`, and `bg:ridgePlot` retain their named repeat geometry and deterministic scrolling, tunneling, interference, spiral, contour, or ridge motion.
- Scenes: `bg:starfield`, `bg:nightMoon`, `bg:skyline`, `bg:sunsetSun`, `bg:oceanWaves`, `bg:rainWindow`, `bg:snowLayers`, `bg:fireworks`, `bg:cloudLayers`, and `bg:mountains` retain layered depth, bounded particle fields, seeded environmental geometry, and cut-local animation.
- Texture/effect backgrounds: `bg:filmStrip`, `bg:vhsBand`, `bg:tornPaper`, `bg:godRays`, `bg:vignettePulse`, `bg:kaleidoscope`, `bg:marble`, and `bg:paperCut` retain moving perforations/scratches, tracking bands, fibrous tears, dusty light rays, pulsing edge light, mirrored radial motifs, turbulent veins, and nested cut-paper contours.
- Cameras: `cam:orbitDrift`, `cam:barrelRoll`, `cam:pendulumSway`, `cam:focusIn`, `cam:rackFocus`, `cam:earthquake`, `cam:floatNoise`, `cam:vertigo`, `cam:tiltDown`, `cam:spiralIn`, `cam:snapPan`, and `cam:jelly` retain the source family's translation, rotation, axis scale, shear, blur, focus, dolly, whip, shake, and squash/stretch signatures.

The background renderer now dispatches horror and bgcam families through one pre-camera/text seam. The bgcam implementation is split by visual responsibility (`gradient`, `textile`, `geometric`, `atmosphere`, `landscape`, `film/light`, and `surface`) around shared bounded rectangle/segment/ring geometry. It never fills an overlay with an opaque base; scene mode still owns the base fill before the selected background is drawn. Camera transforms compose through the existing normalized runtime fields, with degrees converted to radians and pixel-relative travel converted to normalized frame offsets. Every phase is recomputed from absolute `localTime`, cut duration, and stable cut seed. No JIZURA code, mutable playback clock, or stateful animation scheduler is introduced.

The dedicated recording-context test proves all 37 background signatures and all 12 camera signatures are pairwise distinct at their first sample and change at a second cut-relative phase. The real Chromium fixture independently proves visible transparent-overlay pixels, pairwise-distinct phase-A hashes, and cross-phase changes for all 49 entries. `rackFocus` deliberately samples its second frame at 96,000 ticks so evidence reaches the late-cut defocus region instead of comparing two pre-focus frames. The initial `bg:seigaiha` implementation exceeded the 33.33 ms budget at 55.0 ms; increasing the repeat cell while retaining three nested wave rings reduced its final p95 to 12.3 ms. No cost threshold was relaxed.

## Hold/exit `11p_exit.js` slice

Renderer support manifest version 22 completes all 56 catalog entries sourced from JIZURA `11p_exit.js` without executing the source pack. The five baseline recipes `hold:float`, `hold:sway`, `hold:pulse`, `exit:slideOutL`, and `exit:slideOutR` were already supported; the slice adds the remaining 51 recipes:

- Holds: `hold:shimmer`, `hold:colorRun`, `hold:rotateSlow`, `hold:trackBreathe`, `hold:skewWobble`, `hold:beatHop`, `hold:hWave`, `hold:heartbeat`, `hold:orbitSmall`, `hold:jelly`, `hold:scanBand`, `hold:noiseDrift`, `hold:tilt`, `hold:zoomSlow`, `hold:stretchPulse`, `hold:glitchJump`, and `hold:echoTrail`.
- Mask, fold, depth, and motion exits: `exit:sinkMask`, `exit:riseOut`, `exit:flipOutX`, `exit:flipOutY`, `exit:foldOut`, `exit:squash`, `exit:trackOutWide`, `exit:collapse`, `exit:zoomThrough`, `exit:zoomFar`, `exit:spinOut`, `exit:twist`, `exit:waveOut`, `exit:blurOutStagger`, `exit:whipOut`, and `exit:gravity`.
- Shape, dissolve, and material exits: `exit:undraw`, `exit:outlineOut`, `exit:irisClose`, `exit:diagWipeOut`, `exit:blindsClose`, `exit:checkerOut`, `exit:splitApart`, `exit:vSliceDrop`, `exit:melt`, `exit:dissolve`, `exit:backspace`, `exit:scrambleOut`, `exit:glitchDissolve`, `exit:echoOut`, `exit:popOut`, `exit:burn`, `exit:sweepCover`, and `exit:shatterLite`.

The adapter is split into shared glyph geometry plus hold, mask, motion, shape, and material/effect modules. Per-glyph order, clipping, axis scale, color replacement, stable noise, stepwise glitch choices, echoes, slices, particles, and cover bars are recomputed from absolute `localTime`, cut-relative exit progress, cut duration, and the stable cut seed. Canvas owns only drawing and interaction-time transforms; Rust remains the preset/planning truth. The implementation does not load or execute JIZURA JavaScript and introduces no mutable playback state.

The recording-context tests prove that all 17 newly added hold signatures and all 34 newly added exit signatures are pairwise distinct at their first sampled phase and change at a second phase. The real Chromium fixture independently proves visible transparent-overlay pixels, pairwise-distinct phase-A hashes, and cross-phase changes for all 51. Initial per-glyph Canvas blur made `exit:trackOutWide` and `exit:blurOutStagger` exceed budget at 294.9 ms and 203.2 ms p95. Replacing that filter with bounded deterministic soft-edge echo copies retained the blur/spread semantics and reduced them to 1.7 ms and 2.1 ms. No threshold was relaxed; the slowest new entry is `exit:shatterLite` at 12.9 ms p95.

## Core `07_decor.js` slice

Renderer support manifest version 23 completes all 15 catalog entries sourced from JIZURA `07_decor.js` without executing the source pack:

- Back layer: `decor:grid`, `decor:stripes`, `decor:blobs`, `decor:bars`, `decor:shapes`, and `decor:counter`.
- Front layer: `decor:brackets`, `decor:rings`, `decor:dots`, `decor:arrows`, `decor:slash`, `decor:sparks`, `decor:leaders`, `decor:waveform`, and `decor:barcode`.

`core-decors.ts` preserves the source layer contract by dispatching back decorations before the main text layout and front decorations after it. Geometry, entrance/exit envelopes, planner-style parameter choices, counter values, dot/ring motion, leader labels, waveform noise, and barcode structure are recomputed from the resolved cut, absolute `localTime`, cut duration, and a decor-specific stable seed. The Canvas modules only draw the resolved behavior; Rust remains the project and preset truth, and no mutable playback clock or JIZURA execution is introduced.

The recording-context test proves all 15 phase-A signatures are pairwise distinct, every signature changes at the second absolute-time sample, `grid` draws before the lyric, and `barcode` draws after it. The Chromium fixture independently proves all 15 are visible transparent overlays with pairwise-distinct phase-A hashes and cross-phase changes. Every new decor measures in the low cost tier; the highest p95 values are 0.6 ms for `decor:waveform` and `decor:grid`.

## Core and extended style palette slice

Renderer support manifest version 24 completes the catalog style group at 27/27. The 19 newly advertised palettes are `style:magenta`, `style:hud`, `style:mint`, `style:specimen`, `style:transit`, `style:blueprint`, `style:rouge`, `style:sakura`, `style:ocean`, `style:sunset`, `style:forest`, `style:vapor`, `style:newsprint`, `style:synth80`, `style:kraft`, `style:candy`, `style:acid`, `style:sumi`, and `style:gold`.

`style-palettes.ts` keeps palette data separate from runtime dispatch. Each palette maps the first authoritative JIZURA scheme's `bg`, `fg`, `accent`, and `accent2` fields to rocut background, foreground, accent, and secondary colors without loading or executing JIZURA JavaScript. Existing baseline and Horror palette values remain unchanged. The recording-context test distinguishes all 19 native palette signatures and explicitly verifies `style:acid` foreground `#c6ff00` and `style:gold` foreground `#f3e7c4`.

All 19 styles render visible transparent overlays with pairwise-distinct Chromium hashes: `magenta:50ff99df`, `hud:85932210`, `mint:fa051fdc`, `specimen:58facd6a`, `transit:05b0b097`, `blueprint:d06725a2`, `rouge:371bc2c4`, `sakura:f79dc529`, `ocean:7029cc7e`, `sunset:69f9b634`, `forest:1ce57759`, `vapor:60ab59fe`, `newsprint:1d574ed4`, `synth80:a26e4f27`, `kraft:5ca889ef`, `candy:43a47bac`, `acid:ad6e4b56`, `sumi:25ad954d`, and `gold:87acfb88`. Every new style is in the low cost tier at 0.1–0.2 ms p95.

## Core `05_anim.js` source family

Renderer support manifest version 25 completes all 30 catalog entries sourced from JIZURA `05_anim.js`. The latest slice adds nine entrances (`assemble`, `slice`, `type`, `drop`, `stretch`, `spin`, `flicker`, `scramble`, and `zoom`), two holds (`wave` and `glitchtick`), and six exits (`explode`, `fall`, `slice`, `stretch`, `scatter`, and `glitch`) to the 13 previously supported baseline recipes.

`core-entrances.ts`, `core-holds.ts`, and `core-exits.ts` reuse the native glyph and clipping geometry seam while retaining recipe-specific piece assembly/explosion, alternating horizontal slices, typed glyph reveal and cursor, seed-staggered falls, stretch trails, glyph spins, deterministic flicker and replacement characters, glyph waves, glitch bands, gravity collapse, and radial scatter. The dispatchers resolve only from the cut's preset, absolute `localTime`, duration-derived progress, and stable seed. They do not execute JIZURA JavaScript or retain mutable animation state; Canvas remains a drawing surface rather than project or timing truth.

Recording-context tests distinguish all nine new entrance signatures, both hold signatures, and all six exit signatures at phase A, and prove each changes at phase B. Chromium independently reports visible transparent overlays and pairwise-distinct phase-A hashes for every group: entrances `assemble:880cf6c3→dadb4a9d`, `slice:88d5e272→a9ed2fcb`, `type:f225c6b5→f4278a32`, `drop:b065e7ff→fe3975fb`, `stretch:270aa39e→2a5d7ff3`, `spin:aca41d67→e71062c6`, `flicker:eb88dc1a→4ab08d76`, `scramble:b8aba518→baf940e5`, and `zoom:a85745ee→770c8d2f`; holds `wave:73eb2c38→3e7bced9` and `glitchtick:30bc5306→b18fb346`; exits `explode:bf0922e8→4cf57aa4`, `fall:5777d51b→41ee3da9`, `slice:acaecebd→55765f28`, `stretch:fe463739→83a4555a`, `scatter:ea5336b6→7a1971b1`, and `glitch:27deeae2→a5abaae2`.

The 17 new entries have no over-budget cost. `exit:explode` is high at 16.5 ms p95, `enter:assemble` is high at 14.6 ms, `exit:fall` is high at 10.6 ms, `enter:stretch` is medium at 5.3 ms, and the other 13 are low at 0.3–3.8 ms.

## Core `06_layouts.js` source family

Renderer support manifest version 26 completes all 19 catalog entries sourced from JIZURA `06_layouts.js`. The latest slice adds `layout:tile`, `layout:scatter`, `layout:ring`, `layout:wave`, `layout:labels`, `layout:condensed`, `layout:gloss`, `layout:diag`, `layout:circle`, `layout:pill`, `layout:title`, and `layout:interlude` to the seven previously supported baseline layouts.

`core-layouts.ts` dispatches the family across `core-layout-graphics.ts` and `core-layout-cards.ts`, with deterministic geometry helpers in `core-layout-utils.ts`. The native adapters preserve repeated tile rows, seed-stable scattered glyphs, circular glyph tracks, traveling wave trails, orbiting label plates, compressed specimen text, annotated gloss composition, diagonal ticker bands, circular windows, expanding capsules, title rules, and interlude rings/counter semantics. All phases, variants, positions, and labels resolve from the cut, absolute `localTime`, duration-derived progress, and stable seed; Rust remains the project/preset/timing truth and JIZURA JavaScript is not executed. Canvas alpha helpers restore their incoming parent alpha so these layouts remain composition-safe inside outer effects.

The recording-context test distinguishes all 12 new composition signatures. Chromium independently reports visible transparent overlays and pairwise-distinct phase-A hashes for all 12; the source-semantic static `scatter` and `condensed` layouts remain stable, while the other ten change across the sampled phases: `tile:7091659a→f149a0d8`, `scatter:26f65a5c→26f65a5c`, `ring:c00054fb→f700edcd`, `wave:aecfd7de→865c1561`, `labels:b71b299a→258f3efd`, `condensed:7833b340→7833b340`, `gloss:08dc59f0→8c83d600`, `diag:027f8a8f→47d51a75`, `circle:f6bc954d→e22b09df`, `pill:cd169855→e9a36063`, `title:3a82dda8→803f8b00`, and `interlude:c3b7b5c6→dfa2e036`.

All 12 have current 720p cost evidence and none exceeds budget. `layout:gloss` is high at 12.4 ms p95, `layout:labels` is medium at 5.0 ms, and the other ten are low at 0.2–3.5 ms.

## Extended `11p_layoutsA.js` source family

Renderer support manifest version 27 completes all 28 layouts sourced from JIZURA `11p_layoutsA.js`: `lowerThird`, `corners`, `staircase`, `zigzag`, `arcTop`, `spiral`, `gridCells`, `dropCap`, `justified`, `frameBox`, `bubble`, `subtitleBar`, `ticker`, `splitScreen`, `mirror`, `sideways`, `edgeFrame`, `perspective`, `hanko`, `genkou`, `panels`, `filmstrip`, `quote`, `ruler`, `searchBar`, `chat`, `notification`, and `ticket`.

The native implementation routes the family through `layouts-a.ts` and four responsibility buckets: editorial geometry, frames/plates, scene devices, and UI mock-ups. Shared helpers provide deterministic text segmentation, sizing, lines, frames, and plates. The layouts retain lower-third furniture, diagonal corner linking, stepped and zigzag glyph flow, arc/spiral paths, grid cells, drop caps and justified rows, framed/speech/subtitle/ticker/split plates, reflection and rotated edge typography, perspective depth, hanko/genkou motifs, multi-panel and filmstrip compositions, quote/ruler annotations, and search/chat/notification/ticket UI devices. Every phase, selected cell, transform, label, barcode, and panel offset is recomputed from the resolved cut, absolute `localTime`, duration-derived progress, and stable seed; no JIZURA JavaScript or mutable playback state is introduced.

The recording-context test distinguishes all 28 signatures, asserts family-specific frame/grid/transform/UI evidence, and proves every layout changes at the second absolute-time sample. Chromium independently renders all 28 as visible transparent overlays with pairwise-distinct phase-A hashes and cross-phase changes: `lowerThird:952108ff→e3b9df8e`, `corners:e2fe2a0c→604edeea`, `staircase:8639ab7e→f14dc957`, `zigzag:90b2a1e0→20624b44`, `arcTop:44c16710→a4bf7b54`, `spiral:3d3c6301→87f03d27`, `gridCells:44c5ed92→95f3843c`, `dropCap:4f2c95f8→768e6cc5`, `justified:fd8049a4→d2cbc3a4`, `frameBox:4afc8e6f→0142826b`, `bubble:6146030b→cb439ccd`, `subtitleBar:e47f7662→3fdffa21`, `ticker:a08b0efb→70a206fb`, `splitScreen:7cceb1d2→24d62d1d`, `mirror:25aa006c→1702990f`, `sideways:10a54f22→757d6ad2`, `edgeFrame:33e9169e→3193fd1d`, `perspective:37e823cf→b72e5070`, `hanko:cdd30bae→4990ec8c`, `genkou:9599cf7e→cd07251b`, `panels:cfd3bd93→23ea2416`, `filmstrip:727cfeab→91c1d34f`, `quote:509e2725→453216cc`, `ruler:1929ad79→713c42e5`, `searchBar:54e65c2c→c3ecb251`, `chat:3071603e→a4ef7270`, `notification:bded82be→dc46910a`, and `ticket:df470cc1→2e1696bf`.

All 28 have current 720p cost evidence and none exceeds budget. The initial six-layer `perspective` depth stack measured 21.1 ms p95; reducing it to four layers preserved the depth signature and lowered it to 14.8 ms (high). `searchBar` is medium at 7.4 ms, `splitScreen` is medium at 4.2 ms, and the remaining 25 layouts are low at 0.2–4.0 ms.

## Extended `11p_layoutsB.js` source family

Renderer support manifest version 28 completes all 27 layouts sourced from JIZURA `11p_layoutsB.js`: `rain`, `hanging`, `orbit`, `tunnel`, `wordCloud`, `bounceLine`, `elastic`, `crossBands`, `stickerBomb`, `neon`, `keycaps`, `bubbles`, `slotMachine`, `flipBoard`, `credits`, `zoomRepeat`, `splitHalves`, `columnsBig`, `circleWords`, `dotMatrix`, `depthStack`, `typeSpecimen`, `kanjiFocus`, `halfVertical`, `curtain`, `equalizer`, and `tape`.

The native implementation routes the family through `layouts-b.ts` and four responsibility buckets: motion/repetition, graphic devices, media/display devices, and type specimens. It preserves falling glyph rain, hanging strings, orbit and tunnel depth, word clouds, elastic baselines, crossing bands, sticker fields, neon tubing, keycaps, bubbles, reel/flip displays, rolling credits, zoom echoes, split and column typography, circular words, dot-matrix cells, depth stacks, specimen boards, kanji focus, half-vertical composition, curtains, equalizer bars, and tape strips. Every repeated layer, selected glyph, display frame, transform, particle, and bar height is recomputed from the resolved cut, absolute `localTime`, duration-derived progress, and stable seed. No JIZURA JavaScript or mutable playback state is introduced, and layouts that temporarily change alpha restore the incoming Canvas state.

The recording-context test distinguishes all 27 signatures and proves every layout changes at the second absolute-time sample. Chromium independently renders all 27 as visible transparent overlays with pairwise-distinct phase-A hashes and cross-phase changes: `rain:98517007→8b7f2bc2`, `hanging:407e8395→1a2b9042`, `orbit:85b1a3ac→b306d3b6`, `tunnel:54f4dccb→d6df4fd8`, `wordCloud:6660be13→0338bd19`, `bounceLine:1e2026a8→54be7032`, `elastic:b5427dd2→7401952c`, `crossBands:88e067fc→fc55b86e`, `stickerBomb:589fffb3→a79c7134`, `neon:36bf033b→e14a3ddb`, `keycaps:3de8d79b→41d60589`, `bubbles:72cbbba3→b5f5b4d3`, `slotMachine:d7778de4→8c7face9`, `flipBoard:a3fa21d1→0d361503`, `credits:63489064→6428dc45`, `zoomRepeat:838b5a43→a5be99d4`, `splitHalves:f4f2c9dc→eafc1627`, `columnsBig:f3a72507→2d56ca2f`, `circleWords:b93132bb→d9bbaf7b`, `dotMatrix:e735af6e→c770e112`, `depthStack:2fe1ebaf→d73381d2`, `typeSpecimen:b32e6c5a→91828e55`, `kanjiFocus:b927823c→4e2ae6ea`, `halfVertical:dff71f2e→74303908`, `curtain:003bb745→b9bc7a4f`, `equalizer:79e8c909→a5122c46`, and `tape:2bb6bf72→75b4162b`.

All 27 have current 720p cost evidence and none exceeds budget. After reducing bounded repetition in `tunnel` (11→7 layers), `stickerBomb` (11→8 stickers), and `zoomRepeat` (9→7 echoes), their p95 costs are 9.0, 10.7, and 9.6 ms respectively, all high rather than heavy. `circleWords` is medium at 4.3 ms; the other 23 layouts are low at 0.2–3.6 ms.

## Extended `11p_layoutsC.js` source family

Renderer support manifest version 29 completes all 34 layouts sourced from JIZURA `11p_layoutsC.js`: `magazine`, `headlineDeck`, `contents`, `footnote`, `proofread`, `numbered`, `poster`, `swissGrid`, `dictionary`, `ema`, `ransom`, `newspaper`, `vinyl`, `cassette`, `bookSpine`, `polaroid`, `stampSheet`, `postcard`, `letterPaper`, `calendar`, `chochin`, `routeMap`, `stationSign`, `noren`, `tanzaku`, `omikuji`, `kakejiku`, `shoji`, `clapper`, `warningLabel`, `priceTag`, `nameTag`, `stickyNotes`, and `karuta`.

The native implementation routes the family through `layouts-c.ts` and four responsibility buckets: editorial systems, media/paper objects, Japanese objects, and labels/transport objects. It preserves magazine spreads, headline decks, contents and footnote systems, proofing marks, numbered posters and Swiss grids, dictionary entries, ema plaques, ransom lettering, newspaper sheets, vinyl/cassette/book-spine media, instant photos, stamp sheets, postcards, letter paper and calendars, lanterns and transit signage, noren/tanzaku/omikuji/kakejiku/shoji motifs, and clapper/warning/price/name/sticky-note/karuta objects. Every repeated row, halftone mark, paper transform, object state, selected glyph, and phase is recomputed from the resolved cut, absolute `localTime`, duration-derived progress, and stable seed. Temporary alpha changes restore the incoming Canvas value; no JIZURA JavaScript or mutable playback state is introduced.

The recording-context test distinguishes all 34 signatures and proves every layout changes at the second absolute-time sample. Chromium independently renders all 34 as visible transparent overlays with pairwise-distinct phase-A hashes and cross-phase changes: `magazine:2a50157e→4c6fa88d`, `headlineDeck:673cc6d0→4f0f9709`, `contents:d9f4d1ec→bf75b5bf`, `footnote:d8ebaf4a→fef9f421`, `proofread:df2be2e4→6bd2fa1d`, `numbered:d3e5ba3e→75322382`, `poster:fe957e66→3c6fc8a1`, `swissGrid:7d6348d8→5959e557`, `dictionary:23b760f1→dc284415`, `ema:05311e9c→7775c75b`, `ransom:5f08bec2→1f44894a`, `newspaper:723fc593→d454defb`, `vinyl:e745bf5c→8aac2410`, `cassette:56ef2c75→e93147d6`, `bookSpine:5eb318b3→4eb31d94`, `polaroid:34972d7f→d5493861`, `stampSheet:c7657d15→742f77db`, `postcard:cb2b54df→4da17510`, `letterPaper:6231d253→f599501f`, `calendar:de5d1534→62ef6230`, `chochin:12dc7b1e→c4b3dcaf`, `routeMap:38fdaf31→35ef8f7e`, `stationSign:6c988e0d→33648955`, `noren:bfb24f3c→433ea7a6`, `tanzaku:b85c7666→f4200fbc`, `omikuji:ad11f006→482d07fa`, `kakejiku:71364e9f→3c8e1f34`, `shoji:a0242e1c→7cbc8719`, `clapper:f0cc1d68→2faa7501`, `warningLabel:0a2fc274→21434e79`, `priceTag:3c72d524→224dd285`, `nameTag:ad597a1d→caef7296`, `stickyNotes:a1663c39→7976d7f7`, and `karuta:aedb756d→b307878a`.

All 34 have current 720p cost evidence and none exceeds budget. The initial repeated-line and 22-band halftone implementation made `newspaper` heavy at 17.9 ms p95; batching article rows and using bounded pixel-scale halftone cells preserved its editorial signature while lowering it to 3.8 ms (low). `tanzaku` and `stickyNotes` are medium at 4.9 ms, `clapper` is medium at 4.6 ms, `priceTag` is medium at 4.3 ms, and `noren` is medium at 4.2 ms; the other 29 layouts are low. The complete p95 set is `headlineDeck` 0.2, `footnote` 0.3, `numbered` 0.3, `dictionary` 0.3, `swissGrid` 0.4, `shoji` 0.4, `stationSign` 0.4, `kakejiku` 0.5, `routeMap` 0.6, `proofread` 0.6, `poster` 0.6, `letterPaper` 0.6, `contents` 0.7, `bookSpine` 0.7, `cassette` 0.8, `warningLabel` 0.9, `magazine` 0.9, `calendar` 0.9, `omikuji` 1.6, `ema` 2.2, `vinyl` 2.5, `stampSheet` 2.5, `polaroid` 2.6, `ransom` 2.7, `karuta` 2.8, `chochin` 3.4, `newspaper` 3.8, `postcard` 3.9, `nameTag` 3.9, `noren` 4.2, `priceTag` 4.3, `clapper` 4.6, `tanzaku` 4.9, and `stickyNotes` 4.9 ms.

## Extended `11p_layoutsD.js` source family

Renderer support manifest version 30 completes all 34 layouts sourced from JIZURA `11p_layoutsD.js`: `cube`, `cylinder`, `flipCards`, `accordion`, `flag`, `ribbon`, `pendulum`, `pile`, `blocks`, `balloons`, `magnets`, `tiles`, `bulbs`, `ledScroll`, `billboard`, `crowdBubbles`, `crossword`, `wordSearch`, `puzzle`, `shadowPlay`, `kaleido`, `dominoes`, `burst`, `fisheye`, `wall`, `origami`, `zipper`, `sliceStack`, `glitchGrid`, `mosaicTiles`, `maskReveal`, `contour`, `halftoneBig`, and `stencil`. This closes the catalog's layout group at 186/186.

The native implementation routes the family through `layouts-d.ts` and four responsibility buckets: spatial/folded structures, physical objects and signage, games/optical compositions, and material/reveal effects. It preserves cube and cylinder faces, flip cards, accordion folds, waving flags and ribbons, pendulums, piles and dimensional blocks; balloons, magnets, tiles, marquee bulbs, LED scrolls, billboards and crowd bubbles; crossword and word-search grids, puzzles, shadow projection, kaleidoscopic wedges, dominoes, bursts and fisheye warps; and wall perspective, origami, zipper masks, sliced stacks, glitch grids, mosaics, mask reveals, contour lettering, coarse halftone and stencil bridges/spray. Every fold, object placement, grid choice, reveal, transformed text layer, selected glyph and phase is recomputed from the resolved cut, absolute `localTime`, duration-derived progress and stable seed. Temporary alpha changes restore the incoming Canvas value; no JIZURA JavaScript or mutable playback state is introduced.

The recording-context test distinguishes all 34 signatures, asserts family-specific transform, scale, grid, clip, stroke and particle evidence, and proves every layout changes at the second absolute-time sample. Chromium independently renders all 34 as visible transparent overlays with pairwise-distinct phase-A hashes and cross-phase changes: `cube:d148c5ef→b0199902`, `cylinder:f32284b8→7e463dde`, `flipCards:a698bcbd→2804b6c6`, `accordion:89249ec7→2e2ec56c`, `flag:1cfd4b13→29a4d5cf`, `ribbon:926184b3→cbb9c759`, `pendulum:c5bba690→c985c51a`, `pile:543ba1b0→b91e187c`, `blocks:f46b5292→9bc1d9de`, `balloons:bbbab89a→82f3602f`, `magnets:626b757c→f0830c34`, `tiles:1ba40590→7c73c5d9`, `bulbs:046ad6f7→50cdbabc`, `ledScroll:f2f3a3e9→4c4db578`, `billboard:3bc9d1c6→fae28306`, `crowdBubbles:1b5311d1→1a7061c0`, `crossword:decd7a3f→f5114ed9`, `wordSearch:39aa8149→dd27006e`, `puzzle:c2e4d7a8→4d5c4af9`, `shadowPlay:f6414622→fa425f7c`, `kaleido:92277de1→9f7c94b4`, `dominoes:f9cbb3d2→2b42958f`, `burst:69fdd047→9fc19bdd`, `fisheye:fd71075a→671677a6`, `wall:397ed2cf→fba0e8d6`, `origami:19ea45d4→ada532be`, `zipper:0dcb9aeb→15aeff30`, `sliceStack:9702e4f6→a2244957`, `glitchGrid:d218d147→ed2e99b6`, `mosaicTiles:c76eeffe→dcd037ad`, `maskReveal:c19c6674→ecf2f2e6`, `contour:2dc7b44c→a9582847`, `halftoneBig:bfd5b0fd→9b9c869b`, and `stencil:8c629ca7→6262c265`.

All 34 have current 720p cost evidence and none exceeds budget. The initial 30 transformed text layers made `kaleido` unstable at 23.3–41.0 ms p95, including one over-budget run. Reducing it to 16 mirrored radial text layers plus eight cheap wedge rays preserved the kaleidoscope semantics and produced repeat p95 results of 15.1 and 13.6 ms, both high and below the 16.67 ms threshold. The final family contains 30 low, three medium and one high entry. The complete p95 set is `bulbs` 0.4, `mosaicTiles` 0.4, `stencil` 0.4, `ledScroll` 0.4, `origami` 0.5, `zipper` 0.5, `halftoneBig` 0.6, `burst` 0.6, `pendulum` 0.6, `sliceStack` 0.6, `maskReveal` 0.9, `crowdBubbles` 1.0, `puzzle` 1.0, `wall` 1.1, `crossword` 1.1, `wordSearch` 1.1, `shadowPlay` 1.4, `cube` 1.5, `flipCards` 1.6, `tiles` 1.7, `contour` 2.1, `magnets` 2.1, `accordion` 2.2, `cylinder` 2.3, `fisheye` 2.3, `pile` 2.6, `dominoes` 2.9, `ribbon` 3.6, `flag` 3.6, `glitchGrid` 3.8, `blocks` 4.2, `balloons` 4.9, `billboard` 6.1, and `kaleido` 13.6 ms.

## Extended `11p_decor.js` source family

Renderer support manifest version 31 completes all 45 decorations sourced from JIZURA `11p_decor.js`. The source layer contract is preserved exactly. The nine back-layer entries are `halftonePatch`, `beatRing`, `rainStreaks`, `snow`, `lightLeak`, `bokeh`, `risingParticles`, `brushStroke`, and `watermarkKanji`; the other 36 entries render on the front layer: `crosshair`, `cropMarks`, `reticle`, `radar`, `progressRing`, `timecodeBar`, `rulerEdge`, `dimension`, `indexNum`, `dateStamp`, `qrBlock`, `glitchRects`, `concentricSquares`, `triangleSpin`, `lineBurst`, `plusGrid`, `guides`, `waveLine`, `spiralLine`, `checkerStrip`, `orbitDots`, `constellation`, `confetti`, `petals`, `speedCorner`, `twinkle`, `tapePieces`, `scribbleCircle`, `scribbleUnder`, `crossOut`, `highlightMark`, `heartsStars`, `verticalStrip`, `romajiLine`, `bracketsJP`, and `seal`.

The native implementation keeps the existing `core-decors.ts` back/text/front seam and divides behavior into four bounded modules: HUD/measurement, geometric marks, particles/light, and hand-drawn/text ornaments. Measurement labels, clock/date/index data, QR-like cells, radial geometry, particles, light leaks, brush/tape/scribble paths, glyph selection, density, and animation phase are pure functions of the resolved cut, absolute `localTime`, duration and a decor-specific stable seed. Canvas and React hold no project or preset truth, no JIZURA JavaScript is executed, and no mutable playback scheduler is introduced.

The recording-context test distinguishes all 45 signatures, proves that every signature changes at the second absolute-time sample, and asserts that a back-layer representative renders before the lyric while a front-layer representative renders after it. Chromium independently renders all 45 as visible transparent overlays with pairwise-distinct phase-A hashes and cross-phase changes: `crosshair:772c6f58→195f6700`, `cropMarks:cce13c5e→f3146ece`, `reticle:94f58a1a→dbc1801f`, `radar:d13e22af→54e72a4b`, `progressRing:2999a4c1→769055de`, `timecodeBar:5a8b462a→4a978f34`, `rulerEdge:b8153a14→48037a18`, `dimension:dde78f41→c77eec0a`, `indexNum:273467bf→6d0a59db`, `dateStamp:365c5e09→418a5d1c`, `qrBlock:e5c06f07→ab54163d`, `glitchRects:95588844→d7cef5d9`, `concentricSquares:2030f2df→c1bc26a3`, `triangleSpin:6fc039d4→01b1e79e`, `lineBurst:8a700465→d40a0156`, `plusGrid:6e69222e→fc373622`, `guides:0ddce664→6eb72e92`, `waveLine:ffd87844→c327cea7`, `spiralLine:fa28dad3→376b16e9`, `halftonePatch:28e4706c→c704e6bd`, `checkerStrip:79d0706a→6da02d1f`, `beatRing:bd619770→940df57e`, `orbitDots:5a998fc1→7d2abbcd`, `constellation:6cf64f84→68c6f6e0`, `confetti:eda00ee8→ee5bbae7`, `petals:9e3fb3e1→373c9c39`, `rainStreaks:f859bfe8→0c25e2f4`, `snow:20bf074e→333d410e`, `lightLeak:e092e742→2286953d`, `bokeh:2f84e1fe→61765e9b`, `speedCorner:0080a35c→095cc540`, `risingParticles:169cd3bd→e88643d0`, `twinkle:cba05fe0→cb532143`, `brushStroke:f6c1c665→c03a34ae`, `tapePieces:c86dad09→16495e85`, `scribbleCircle:14a9761f→016b3959`, `scribbleUnder:597bbbf8→58267373`, `crossOut:068f666a→6b85fb70`, `highlightMark:3166d549→2f6c9fec`, `heartsStars:e59d34ae→3da71b84`, `watermarkKanji:8f64d662→75570f85`, `verticalStrip:826488ec→a7a8deff`, `romajiLine:473cd99b→32f5c253`, `bracketsJP:6e3f89f2→a38ea066`, and `seal:f1b019ae→6dca14b9`.

All 45 entries are low-cost at 1280×720 and none needs a renderer downgrade. The final p95 set is `romajiLine` 0.3, `cropMarks` 0.3, `timecodeBar` 0.3, `bracketsJP` 0.4, `seal` 0.4, `tapePieces` 0.4, `crosshair` 0.4, `snow` 0.4, `glitchRects` 0.4, `progressRing` 0.4, `guides` 0.4, `highlightMark` 0.4, `orbitDots` 0.4, `qrBlock` 0.4, `risingParticles` 0.4, `indexNum` 0.4, `dateStamp` 0.4, `dimension` 0.4, `reticle` 0.5, `triangleSpin` 0.5, `bokeh` 0.5, `watermarkKanji` 0.5, `rulerEdge` 0.5, `lineBurst` 0.5, `verticalStrip` 0.5, `waveLine` 0.6, `checkerStrip` 0.6, `rainStreaks` 0.6, `brushStroke` 0.6, `crossOut` 0.6, `twinkle` 0.7, `confetti` 0.7, `spiralLine` 0.8, `petals` 1.0, `lightLeak` 1.0, `speedCorner` 1.0, `concentricSquares` 1.0, `halftonePatch` 0.9, `constellation` 0.9, `scribbleUnder` 0.9, `beatRing` 1.4, `scribbleCircle` 1.7, `radar` 1.7, `plusGrid` 2.4, and `heartsStars` 3.8 ms.

## Extended `11p_decorB.js` source family

Renderer support manifest version 32 completes all 55 decorations sourced from JIZURA `11p_decorB.js`, closing catalog decor coverage at 130/130. The source layer contract is preserved exactly. The eight back-layer entries are `seigaiha`, `asanoha`, `kasumi`, `ruledLines`, `starField`, `sunRays`, `rainRipples`, and `smoke`; the other 47 entries render on the front layer. Responsibility is split by source semantics: Japanese motifs (`kamon`, `seigaiha`, `asanoha`, `hanabi`, `chochin`, `shimenawa`, `sensu`, `tsukiKumo`, `momiji`, `namiGashira`, `kasumi`), HUD (`hexGrid`, `spectrumRing`, `dataColumns`, `spinner`, `headingTape`, `glyphLock`, `atomOrbit`, `sonarArcs`, `circuit`), print/stationery (`swatches`, `ruledLines`, `registration`, `punchHoles`, `staple`, `paperClip`, `indexTabs`), nature/atmosphere (`vines`, `cloudPuffs`, `starField`, `moonPhases`, `sunRays`, `rainRipples`, `bubbles`, `smoke`, `dandelion`, `fireflies`), graphic marks (`memphis`, `zigzagRibbon`, `polkaPatch`, `stripeCircle`, `decoCorners`, `halfCircles`, `loopArrows`, `starburst`, `tally`), and UI widgets (`cursorClick`, `windowChrome`, `progressBar`, `toggleSwitch`, `notifBell`, `likeCounter`, `mediaControls`, `volumeBars`, `musicNotes`).

All placement, lattice density, glyph choice, counters, controls, particles, drift, progress and pulse are pure functions of the resolved cut, absolute `localTime`, duration and a decor-specific stable seed. The Canvas modules own only drawing; Rust remains project/preset/cut/timing truth, React does not schedule animation, no JIZURA JavaScript is executed, and no mutable playback state is introduced. The dense `seigaiha` and `asanoha` patterns use bounded corner regions and batched native Canvas paths when supported, with the recording-context fallback retaining an explicit animated signature line.

The recording-context test distinguishes all 55 signatures, proves that every signature changes at the second absolute-time sample, and asserts that `ruledLines` renders before the lyric while `windowChrome` renders after it. Chromium independently renders all 55 as visible transparent overlays with pairwise-distinct phase-A hashes and cross-phase changes: `kamon:eb7f2d02→eeb4d309`, `seigaiha:044883eb→24b55efe`, `asanoha:a7e04585→dc5ea68b`, `hanabi:c50e927f→84435140`, `chochin:d0aeaf4a→4023a940`, `shimenawa:26b44d6f→2c4bd6b9`, `sensu:c6ff0fa3→6a63c08b`, `tsukiKumo:1aa34c24→5979e41a`, `momiji:67ba6430→6148aea9`, `namiGashira:07e1e24a→28b853d5`, `kasumi:b4377f62→385a4e6e`, `hexGrid:c3c71119→89022c7d`, `spectrumRing:74ce4fda→a4ddf83d`, `dataColumns:0b7b27c4→d0b251b3`, `spinner:c5027ffd→9b65b583`, `headingTape:fe2c8685→6ed0ca02`, `glyphLock:e3043e22→a96f5aa9`, `atomOrbit:3403f68e→ad1262f6`, `sonarArcs:bb0ed4e5→21585fe8`, `circuit:d1ecbc45→d53da2f8`, `swatches:cb544596→0b7f515f`, `ruledLines:a8d7dbbc→8fe4c276`, `registration:340ed729→79308424`, `punchHoles:af886cd8→936a70af`, `staple:8bfdb891→92ed7c83`, `paperClip:fc69adfb→7899a803`, `indexTabs:93c4a43a→c22b9688`, `vines:8c7fa471→eef1932a`, `cloudPuffs:46607d0b→362e91b2`, `starField:43b174e1→c15bf904`, `moonPhases:ec489146→351ed26d`, `sunRays:baf01f1f→242186f0`, `rainRipples:ffd20476→4a2ce34a`, `bubbles:7ad4f6e4→6de0b81c`, `smoke:583bc1e5→932e57fb`, `dandelion:f740e8d5→f8b07346`, `fireflies:a5ec0aac→2e10b8ab`, `memphis:a5b99215→99b2b27d`, `zigzagRibbon:31655fd3→0f6e7cc7`, `polkaPatch:07429036→e4f76119`, `stripeCircle:6c40df57→103648af`, `decoCorners:6ef05414→0007b225`, `halfCircles:2bb56d82→06e492dc`, `loopArrows:cab497ea→e0619ca1`, `starburst:3e68f44f→72a238eb`, `tally:5903aa0e→1f47b728`, `cursorClick:7eead1c2→b439bdb6`, `windowChrome:b2f33acf→78223c3c`, `progressBar:37d1fdae→4bf68d28`, `toggleSwitch:1101811a→de710e50`, `notifBell:e80818d3→699367c6`, `likeCounter:de1b8405→b7e4b46a`, `mediaControls:5da43ba4→eb7f7168`, `volumeBars:08174676→269f1819`, and `musicNotes:d9f9a07b→8f39e657`.

The first full-frame short-segment implementations measured `seigaiha` at 98.3 ms and `asanoha` at 39.2 ms p95. Bounded regions plus batched paths reduced the latest repeated measurements to 0.9 and 0.7 ms without changing their source-recognizable wave and hemp-leaf semantics. All 55 entries are currently low, with no medium, high, heavy or over-budget item. The complete p95 set is `progressBar` 0.2, `indexTabs` 0.3, `kasumi` 0.3, `musicNotes` 0.3, `notifBell` 0.3, `staple` 0.3, `volumeBars` 0.3, `windowChrome` 0.3, `dataColumns` 0.4, `fireflies` 0.4, `glyphLock` 0.4, `paperClip` 0.4, `ruledLines` 0.4, `spinner` 0.4, `starburst` 0.4, `starField` 0.4, `tally` 0.4, `toggleSwitch` 0.4, `chochin` 0.5, `circuit` 0.5, `mediaControls` 0.5, `polkaPatch` 0.5, `sensu` 0.5, `swatches` 0.5, `dandelion` 0.6, `headingTape` 0.6, `likeCounter` 0.6, `asanoha` 0.7, `cursorClick` 0.7, `decoCorners` 0.7, `sonarArcs` 0.7, `spectrumRing` 0.8, `hanabi` 0.9, `loopArrows` 0.9, `momiji` 0.9, `seigaiha` 0.9, `stripeCircle` 0.9, `kamon` 1.0, `namiGashira` 1.0, `registration` 1.0, `zigzagRibbon` 1.0, `memphis` 1.1, `punchHoles` 1.2, `sunRays` 1.2, `moonPhases` 1.3, `vines` 1.3, `halfCircles` 1.4, `tsukiKumo` 1.4, `shimenawa` 1.6, `hexGrid` 1.7, `atomOrbit` 1.8, `smoke` 2.1, `cloudPuffs` 2.3, `bubbles` 2.8, and `rainRipples` 4.0 ms.

## Complete `11p_looks.js` source family

Renderer support manifest version 33 completes all 87 entries sourced from JIZURA `11p_looks.js`. The four existing baseline treatments are `glow`, `outline`, `outlineFill`, and `underline`; this slice adds the other 83 entries:

- 20 treatments: `doubleOutline`, `extrude`, `longShadow`, `hardShadow`, `softShadow`, `marker`, `strike`, `boxed`, `gradientV`, `splitColor`, `halftone`, `stripes`, `hatch`, `dotted`, `alternate`, `italic`, `wide`, `tall`, `echoOutline`, and `emphasisDots`;
- 24 backgrounds: `sunburst`, `concentric`, `halftoneFade`, `bigStripes`, `splitV`, `splitH`, `splitDiag`, `gradientSweep`, `spotlight`, `tvBars`, `checker`, `bigChar`, `speedLines`, `scanBars`, `dotGrid`, `retroGrid`, `bokehBg`, `particlesBg`, `ripples`, `polka`, `eqBars`, `borderFrame`, `letterbox`, and `noiseField`;
- 15 cameras: `pullOut`, `panL`, `panR`, `tiltUp`, `dutch`, `handheld`, `beatPunch`, `whipIn`, `crashZoom`, `bounce`, `roll`, `driftDiag`, `shakeHard`, `dollyIn`, and `stepZoom`;
- 24 screen effects: `panelWipe`, `irisTrans`, `doors`, `blindsTrans`, `rgbSplit`, `smear`, `vhsRoll`, `trackingNoise`, `mirrorFlash`, `strobe`, `posterize`, `hueShift`, `tileShift`, `filmBurn`, `whipBlur`, `blackFrame`, `whiteFrame`, `gridRepeat`, `waveWarp`, `pixelDrift`, `zoomPunch`, `lightSweep`, `crtOff`, and `splitSlide`.

The implementation follows the established native seams rather than executing the JIZURA pack. Treatments are split across shared glyph/context helpers plus basic and styled drawing modules, then dispatched by `typography-treatments.ts`. Graphic and atmospheric backgrounds reuse the bounded background geometry helpers and dispatch before the older bgcam families. Cameras resolve after horror, kinetic and bgcam camera families. Screen effects are divided into overlay geometry, source-pixel family A, source-pixel family B, and shared scratch-surface/capability code; `screen-effects.ts` preserves declared effect order and falls back to a deterministic recording signature when the supplied context cannot capture pixels. Scratch canvases are cached only as render resources. Every phase, reveal, random choice, displacement and camera transform is recomputed from resolved cut data, absolute `localTime`, duration and stable seed; Rust remains project/preset/cut/timing truth.

Real Canvas pixel effects capture the current composed frame before applying each effect. Overlay mode uses source-bound composition so `blackFrame`, `whiteFrame`, `irisTrans`, `doors`, `crtOff`, color treatments and burn/light overlays cannot paint previously transparent pixels; scene mode may retain full-frame semantics. The completed probe also tightened four implementations found by cross-phase pixel evidence: `mirrorFlash` now has four distinct time-selected mirror modes, `strobe` uses a continuous absolute-time pulse, `posterize` adds source-atop palette quantization, and `gridRepeat` advances from a 2×2 to 3×3 stage. No mutable playback state or React timer participates.

Recording-context tests prove 20 treatment signatures, 24 background signatures, 15 camera signatures, and 24 FX fallback signatures are pairwise distinct at phase A. The nine animated treatments (`extrude`, `longShadow`, `marker`, `strike`, `boxed`, `halftone`, `dotted`, `echoOutline`, and `emphasisDots`) change at their second sample; all backgrounds, cameras and effects change across sampled phases. Chromium independently renders every entry on a visible transparent overlay with pairwise-distinct phase-A pixels. Representative pairs are treatments `extrude:6b1e9d25→5acb75c6`, `boxed:9135ee39→39880fa5`, and `echoOutline:09b5b6ba→c818f21f`; backgrounds `sunburst:7b9dbbaa→352089e8`, `retroGrid:48f7b62a→7b2547ac`, and `noiseField:56002932→9ca92e28`; cameras `pullOut:1b1c8db0→86ceb995`, `beatPunch:b0c93054→53c33e0a`, and `stepZoom:dc000a98→16fb393f`; effects `rgbSplit:dfa2b022→1c20c390`, `mirrorFlash:20c68b9a→0a372da1`, `posterize:52105358→f7bcaed4`, and `splitSlide:d1fc600a→ed72ac0e`. The browser probe output records the complete 83-entry hash set.

All 83 new entries remain within the 33.33 ms renderer budget. The family has 70 low, eight medium, three high and two heavy entries, with no over-budget item. Heavy entries are `fx:whipBlur` 30.3 ms and `fx:rgbSplit` 27.6 ms. High entries are `cam:shakeHard` 11.6 ms, `fx:posterize` 10.8 ms, and `cam:whipIn` 9.9 ms. Medium entries are `fx:hueShift` 8.2 ms, `fx:crtOff` 5.7 ms, `fx:gridRepeat` 5.3 ms, `fx:waveWarp` 5.0 ms, `fx:zoomPunch` 4.7 ms, `fx:mirrorFlash` 4.5 ms, `fx:splitSlide` 4.2 ms, and `fx:tileShift` 4.2 ms; the other 70 entries are low. The audit now also registers the previously omitted 55 `decorB.*` pixel fixtures, so the supported-entry preview-evidence gate is backed by explicit item mappings rather than an aggregate probe alone.

## Complete `11p_exitB.js` source family

Renderer support manifest version 34 completes all 51 entries sourced from JIZURA `11p_exitB.js` without loading or executing that JavaScript:

- 12 absolute-time holds: `glowFlicker`, `windGust`, `dangle`, `eqBounce`, `flashBox`, `glintSweep`, `flipSwap`, `shadowSway`, `magnetJiggle`, `typeRattle`, `focusRack`, and `pluckString`;
- 11 paper, mask, and particle exits: `peelOff`, `crumpleOut`, `tearOut`, `scorchOut`, `overexposeOut`, `scanOut`, `stripesOut`, `halftoneOut`, `eraserOut`, `vacuumOut`, and `sandOut`;
- 14 mechanical and spatial exits: `shredOut`, `dominoOut`, `hingeOut`, `rocketOff`, `bounceOff`, `balloonOff`, `deflateOut`, `hazeOut`, `glassBreak`, `zipOut`, `clapShut`, `lampOff`, `slotOut`, and `clockOut`;
- 14 signal, weather, and graphic exits: `matrixOut`, `tornadoOut`, `rollUpOut`, `snakeOut`, `flutterOut`, `rollOff`, `fanClose`, `rgbSplitOut`, `shockOut`, `floodOut`, `slashOut`, `mosaicOut`, `scribbleOut`, and `candleOut`.

The adapter is deliberately split by responsibility: `exit-b-drawing.ts` owns bounded geometry and whole-text drawing helpers, `exit-b-holds.ts` owns the 12 persistent behaviors, three exit modules own paper/mask, mechanical/spatial, and signal/graphic semantics, and `exit-b-exits.ts` is the dispatcher. `typography-holds.ts` and `typography-exits.ts` remain the only integration seams. Rust continues to own resolved project, preset, cut, timing, duration, and seed truth; every Canvas phase is recomputed from absolute `localTime`, normalized `exitProgress`, duration, and the stable cut seed. There is no mutable playback state, React timer, second timeline, or JIZURA runtime.

The recording-context test keeps all 12 hold phase-A signatures and all 39 exit phase-A signatures pairwise distinct, and proves every entry changes at a source-relevant second phase. It also asserts the inverse beat plate, glint clip, 12-layer swaying shadow, glass fragments, matrix glyph rain, mosaic cells, and scribble particles directly. The manifest-wide smoke resolves and draws all 51 without `unsupported-preset` diagnostics. Real Chromium independently proves both frames are visible transparent overlays, every entry changes across phases, and phase-A hashes are distinct within the hold and exit groups. Representative pixel pairs are `flashBox:d495bef7→5021c0bc`, `glintSweep:26b12259→45bdeff0`, `shadowSway:2191adb4→371d8be3`, `glassBreak:1a5aed28→43eb549c`, `matrixOut:802df5cb→ff9b54f6`, `mosaicOut:dd37065e→5e0173bc`, and `scribbleOut:e3765e16→119ffd83`.

All 51 entries remain inside the 33.33 ms renderer budget: 43 low, six medium, one high, one heavy, and zero over-budget. The slowest entry is `exit:glassBreak` at 19.7 ms p95; `exit:balloonOff` is 8.8 ms, while the six medium entries range from 4.6 to 7.6 ms. No cost threshold was relaxed. The source family closes the catalog hold and exit groups at 52/52 and 109/109 supported.

## Complete `11p_treattrans.js` source family

Renderer support manifest version 35 completes all 47 entries sourced from JIZURA `11p_treattrans.js` without executing the source pack:

- 27 treatments: `neonOutline`, `chrome`, `rainbow`, `glitchSplit`, `shadowStack`, `stencilGap`, `waterline`, `karaoke`, `sizeWave`, `rotateAlt`, `baselineShift`, `fauxBold`, `circled`, `bracketsQuote`, `reflection`, `inline`, `sticker`, `gradientSweep`, `kerningWide`, `monoGrid`, `outlineOffset`, `toneShadow`, `fadeChars`, `cutShift`, `focusPull`, `spotChar`, and `ransom`;
- 10 mask/reveal transitions: `wipe`, `diagonalWipe`, `clockWipe`, `irisOpen`, `doorsOpen`, `blinds`, `checker`, `blockDissolve`, `inkBlob`, and `pixelate`;
- 10 motion/spatial transitions: `pushSlide`, `cover`, `uncover`, `zoomThrough`, `whipPan`, `spinOut`, `shatterTiles`, `sliceShift`, `cubeTurn`, and `flashCross`.

Treatment geometry is split into shared drawing helpers plus basic, graphic, and editorial modules, with `treat-trans-treatments.ts` restoring Canvas state before returning through the existing `typography-treatments.ts` seam. Transition geometry is split into mask/reveal and spatial modules behind `treat-trans-transitions.ts`; `typography-transitions.ts` remains the sole adjacent-cut dispatcher. Transition boundaries preserve the established contract: progress at or below zero draws the previous cut exactly, progress at or above 0.999 draws the current cut exactly, and intermediate progress composes both cuts. Rust continues to own resolved project, preset, cut, timing, duration, and seed truth. Animated treatment phases, reveal masks, tile order, directions, shatter motion, and pixel/block selection are pure functions of absolute `localTime`, normalized progress, and the stable cut seed.

Recording-context tests keep all 27 treatment phase-A signatures and all 20 transition phase-A signatures pairwise distinct. Ten source-semantic animated treatments change at their second absolute-time sample, every transition changes across the two sampled progress values, and every intermediate transition consumes both `BEFORE` and `AFTER`. Direct feature assertions cover multi-pass neon strokes, chrome/karaoke clipping, reflected negative scale, ransom scraps, clock sectors, ink lobes, shatter tile rotations, and pixel cells. Chromium independently renders all 47 entries as visible transparent overlays. Treatment phase-A hashes are pairwise distinct, the ten animated treatments change, and all 20 transitions have pairwise-distinct phase-A hashes plus cross-phase changes. Representative pairs are `neonOutline:743eff92→bde352d9`, `karaoke:1313546f→200d8723`, `gradientSweep:3c389950→f0e0107d`, `focusPull:b9687268→b986ae46`, `clockWipe:e5217f8f→e608df4f`, `inkBlob:7c6ad347→b37296d5`, `shatterTiles:02332315→bcd88c82`, `flashCross:487163e2→a302c454`, and `pixelate:aab9f737→39701180`.

All 47 entries remain inside the 33.33 ms renderer budget: 44 low, two medium, one high, and zero heavy or over-budget. The only high item is `trans:shatterTiles` at 14.8 ms p95; `trans:pixelate` and `trans:zoomThrough` are medium at 5.5 and 4.9 ms, and all other entries are low. The first `focusPull` implementation used one Canvas blur filter per glyph and measured 198.5 ms p95; replacing that with bounded deterministic soft-focus ghost layers reduced it to 1.0 ms without changing the moving focus-band semantics. Catalog treatment and transition groups are now complete at 62/62 and 27/27 supported.

## Complete `11p_enterB.js` source family

Renderer support manifest version 36 completes all 47 entrances sourced from JIZURA `11p_enterB.js` without loading or executing that JavaScript:

- 16 physics and object-motion entrances: `springIn`, `pendulum`, `rollIn`, `slingshot`, `rockSettle`, `bounceBall`, `snapRail`, `fanOpen`, `cylinder`, `shuffle`, `stopMotion`, `ripple`, `zipper`, `zoomAlt`, `tiltUp`, and `stickerPeel`;
- four paper entrances: `crumple`, `noteUnfold`, `tornJoin`, and `splitFlap`;
- seven light and optical entrances: `overexpose`, `glint`, `loupe`, `filmFeed`, `backlight`, `lightLeak`, and `heatHaze`;
- six digital-device entrances: `crtOn`, `interlace`, `loadingBar`, `dither`, `odometer`, and `matrixRain`;
- 14 graphic and mask entrances: `hatchFill`, `brushReveal`, `inkDrop`, `quarters`, `invertBox`, `printRegister`, `echoCount`, `liquidFill`, `windBlown`, `strokeOrder`, `clockWipe`, `shadowFirst`, `bubbles`, and `tokoroten`.

The adapter is split by responsibility: `enter-b-drawing.ts` owns bounded glyph, line, polygon, and stable-noise helpers; `enter-b-physics.ts`, `enter-b-paper-light.ts`, `enter-b-digital.ts`, and `enter-b-graphic.ts` own the four behavior families; and `enter-b-entrances.ts` is the isolated dispatcher behind the existing `typography-entrances.ts` seam. Every branch restores Canvas state, and progress at or above 0.999 falls through to the ordinary stable-text draw. Rust remains the source of truth for project, preset, cut, timing, duration, and seed. Canvas behavior is recomputed from absolute `localTime`, normalized `enterProgress`, duration, and the stable cut seed; no mutable playback state, React timer, or JIZURA runtime is introduced. Expensive source blur semantics use bounded deterministic ghost or geometric approximations, and path-limited recording contexts retain a bounds fallback for polygon clipping.

The recording-context test keeps all 47 phase-A signatures pairwise distinct and proves every entrance changes at its second source-relevant phase. Feature assertions cover spring and pendulum transforms, split-flap panels, film-feed framing, CRT scan geometry, dither cells, matrix glyph rain, clock sectors, stroke order, and the `tokoroten` slit clip. Chromium independently renders all 47 as visible transparent overlays with pairwise-distinct phase-A hashes and cross-phase changes. Representative pairs are `springIn:d8f43383→5953dfcd`, `pendulum:2a9514ff→65cf8d03`, `splitFlap:713b3e77→f1236104`, `filmFeed:990fd419→a61e1ea9`, `dither:d08f459f→7d87caba`, `matrixRain:8034fd87→0dd4bdd8`, `clockWipe:e61cbda4→c06632ec`, and `tokoroten:356ed424→832f3971`.

All 47 entries remain inside the renderer budget: 41 low, six medium, and zero high, heavy, or over-budget. The six medium entries are `enter:overexpose` 5.4 ms, `enter:zoomAlt` 5.2 ms, `enter:strokeOrder` 4.8 ms, `enter:shadowFirst` 4.3 ms, `enter:pendulum` 4.2 ms, and `enter:rollIn` 4.2 ms; the other 41 are low. Catalog entrance coverage is now 87/125 supported.

## Complete `11p_enter.js` source family

Renderer support manifest version 37 completes JIZURA `11p_enter.js`. `slideL` and `slideR` already use rocut's baseline entrance path; this slice adds the other 38 recipes:

- glyph and folding motion: `flipX`, `flipY`, `domino`, `fold`, `unroll`, `randomOrder`, `bounceBig`, `squashDrop`, and `rubber`;
- graphic masks and drawn reveals: `riseMask`, `dropMask`, `slideWhole`, `strokeDraw`, `outlineFill`, `splitJoin`, `vSlice`, `shutter`, `iris`, `diagWipe`, `blinds`, and `checker`;
- motion and soft entrances: `whip`, `skewIn`, `trackIn`, `trackOut`, `blurStagger`, `fadeStagger`, `waveIn`, `spiralIn`, `zoomOut`, `resolve`, and `magnet`;
- digital and material reveals: `glitchIn`, `echoIn`, `inkBleed`, `neonOn`, `cursorSweep`, and `stamp`.

The implementation is split by drawing responsibility: `enter-a-drawing.ts` owns bounded shared geometry, `enter-a-glyph.ts` owns per-glyph and folding transforms, `enter-a-masks.ts` owns clipping and graphic reveals, `enter-a-motion.ts` owns motion and soft arrivals, `enter-a-digital.ts` owns signal/material effects, and `enter-a-entrances.ts` isolates dispatch and Canvas state restoration behind `typography-entrances.ts`. Blur, ink, and neon semantics use bounded ghost or outline passes instead of unbounded per-glyph filters. At `enterProgress >= 0.999`, the existing typography seam resumes ordinary stable text. Rust remains the source of truth for project, preset, cut, timing, duration, and seed; every frame is recomputed from absolute `localTime`, normalized progress, duration, and the stable cut seed.

The recording-context test keeps all 38 phase-A signatures pairwise distinct and proves every entrance changes at a second source-relevant phase. Chromium independently renders all 38 as visible transparent overlays with pairwise-distinct phase-A hashes and cross-phase changes. Representative pairs are `riseMask:db30a0b6→514482e4`, `flipX:7ecc05e3→54b2e80c`, `strokeDraw:07133c4b→89c03670`, `checker:4a4d9483→550fec87`, `bounceBig:427976ee→e9100c3c`, `glitchIn:a5e5f1a0→330c0455`, `spiralIn:eaa6c672→e3d738a4`, and `neonOn:f28b2475→4e1969f6`.

All 38 entries remain inside the renderer budget: 33 low, four medium, one high, and zero heavy or over-budget. The high entry is `enter:echoIn` at 10.9 ms; the medium entries are `enter:neonOn` 6.3 ms, `enter:waveIn` 5.7 ms, `enter:inkBleed` 5.4 ms, and `enter:magnet` 4.2 ms. Catalog entrance coverage is now complete at 125/125 supported.

## Complete `11p_fxB.js` source family

Renderer support manifest version 38 completes all 34 screen effects sourced from JIZURA `11p_fxB.js` without loading or executing that JavaScript:

- optical and lens effects: `radialChroma`, `bloomFlash`, `bulge`, `halftone`, `duotone`, `ditherBit`, `lightRays`, `anamorphic`, `starGlint`, `negativeRing`, `edgeDetect`, and `defocus`;
- frame and spatial effects: `rotateSnap`, `echoFrames`, `kaleido`, `filmAdvance`, `perspectiveTilt`, `ripple`, `zoomStutter`, `shatter`, `snapshot`, `squash`, and `loopScroll`;
- signal and pixel effects: `pixelSort`, `interlace`, `macroBlock`, `bandInvert`, `tvStatic`, `dustScratches`, `colorBars`, and `scanBar`;
- graphic overlays: `heartbeat`, `focusLines`, and `speedLines`.

The adapter is split into optical/lens, frame/spatial, signal/pixel, and graphic/overlay modules behind a single `fx-b-screen-effects.ts` dispatcher. It reuses the existing source-capture and source-canvas-scoped scratch surfaces from the Looks family; those surfaces cache render resources only and never carry animation state. Full-frame color overlays use `source-atop` in overlay mode so transparent pixels stay transparent. The outer screen-effect dispatcher isolates Canvas state around each declared effect and preserves the existing Core → Looks → FxB → Horror order. Rust remains the source of truth for project, preset, cut, timing, duration, and seed; every displacement, band, fragment, pulse, pixel choice, and phase is recomputed from absolute `localTime`, normalized progress, duration, and a stable effect-specific seed.

The recording-context fallback keeps all 34 phase-A signatures pairwise distinct and proves every effect changes at a second absolute-time sample, including environments that cannot capture pixels. Chromium independently executes the real Canvas path for all 34, renders visible transparent overlays, retains pairwise-distinct phase-A hashes, and changes across phases. Representative pairs are `radialChroma:7c640a65→7cd21847`, `halftone:179fddc7→95b4420c`, `bandInvert:55f17b33→b9572f0c`, `kaleido:14f148e3→f3fb9703`, `shatter:f98a0202→9f0cbaf0`, `snapshot:9c968217→37671fa8`, and `loopScroll:535b17f7→8a8662aa`. Pixel evidence caught and corrected two real semantic defects before advertisement: `halftone` no longer intersects successive `destination-in` masks into an empty result, and `bandInvert` now has a source-bound dynamic tint plus phase-dependent colored bands.

All 34 entries remain inside the 33.33 ms renderer budget: 20 low, eight medium, four high, two heavy, and zero over-budget. Heavy entries are `fx:defocus` 27.5 ms and `fx:echoFrames` 17.5 ms. High entries are `fx:bloomFlash` 15.9 ms, `fx:ditherBit` 11.1 ms, `fx:radialChroma` 10.2 ms, and `fx:edgeDetect` 9.2 ms. The eight medium entries range from `fx:bulge` 4.5 ms through `fx:halftone` 7.2 ms; the remaining 20 are low. Catalog screen-effect coverage is now complete at 69/69 supported.

## JIZURA v1 project import slice

`rust/crates/motion-text/src/jizura_import.rs` provides a dedicated `import_jizura_motion_text_project` boundary instead of overloading the plain/LRC sequence factory. It accepts inert JSON text plus the advertised renderer-support manifest and returns `sequenceJson`, `resourcesNeeded`, `compatibilityReport`, and `diagnostics`. Rust validates schema version 1, rejects future versions and unknown explicit presets without returning a partial sequence, applies the original manual/LRC/offset/BPM/line-scale/tail/typeset-lead timing rules, preserves automatic language detection, and imports title, artist, language, seed, style, built-in font role, per-line preset overrides, per-cut `cutTech`/`cutLayouts`, and bounded `lockedCuts` snapshots. Imported cuts still resolve from project data, absolute time, duration-derived progress, and a stable seed; React only selects the file and presents the result.

The original JSON is retained only as inert provenance in `sequence.source.text`. External paths, URLs, user-font records, and unknown fields are never executed or resolved. Audio bytes are not present in a JIZURA project file and are reported as a required rocut asset relink. User fonts and the unavailable zh-Hans/zh-Hant/ko offline substitution packs are likewise reported as missing resources. Unlocked automatic choices are deterministically replanned by rocut and marked `approximated`; current per-cut preservation uses a broader whole-cut lock, inactive palette values remain provenance, and title/artist are metadata rather than a reconstructed title card. These differences remain visible in the compatibility report, so a warning-bearing import cannot be presented as bit-exact compatibility.

The fixed fixture pair `rust/crates/motion-text/fixtures/jizura-v1-project.json` and `jizura-v1-expected.json` is checked against the original JIZURA `J.plan` implementation by `script/probe-jizura-import-fixture.mjs`. The original runtime and native importer agree on `zh-Hans`, title `城里的光`, artist `Rocut Fixture`, 528,000 ticks, starts `[60000, 240000]`, durations `[180000, 180000]`, the first-line `huge/pop/pulse/shrink` preset, and the second line's first-cut `type/wipe/drift/wipe` preset. The canonical-WASM factory seam strictly decodes the four-part result. `JizuraImportControl` accepts `.jizura.json`/JSON, surfaces compatibility and missing-resource details, and calls the existing `insertMotionTextSequence()` transaction rather than introducing a second project path.

`script/probe-jizura-import-ui.mjs` proves the real Chromium path imports two cues at sequence revision r0, displays the audio-relink warning, inserts the `城里的光 · JIZURA` clip, and retains that clip after a full page reload. The latest canonical WASM, including the importer, preset-preview factory, declared font-language metadata, Rust-owned language-asset resolver, the `gothic_bold_zh_hans` language asset, precise lock mutation and planning-control factory, is 5,511,220 bytes with SHA-256 `14de620a1bfa38228a43e4103cc557ae7a27bbb30185bfffae91b17d685e75a8`; its contract records 59 wrapper exports, 76 stable binary exports, and three toolchain-dependent trampolines. The root and `apps/web` installed copies were later synchronized through the normal dependency path (`npx --yes bun@1.2.18 install`) and are now byte-identical to that canonical build, so the full `check:wasm` aggregate is green.

## Baseline preview-evidence completion

The browser fixture now isolates each of the 39 supported entries that predate Batch B. Non-target motion fields use `enter:cut`, `exit:cut`, `hold:still`, and `cam:static`; the target field alone is varied. Every sample is non-empty, retains transparent overlay pixels, and reports finite content bounds. Styles, layouts, and treatments are pairwise pixel-distinct; dynamic entrances, holds, exits, and the push camera change across their two sampled phases. The intentionally static `enter:cut`, `hold:still`, and `exit:cut` remain stable.

- Styles: `noir:67098fa0`, `crimson:7956940c`, `caution:ba462bf7`, `paper:429aeca6`, `mono:f5311b18`.
- Layouts: `center:b4b31bcd`, `mixed:e4a226c0`, `vcols:9ef2cfee`, `marquee:75c1e68d`, `huge:d3cf0f1b`, `type:14719cba`, `stack:d91d1329`.
- Entrances: `cut:044f9c3a→044f9c3a`, `pop:ed7ec421→044f9c3a`, `wipe:520f3ba7→044f9c3a`, `blur:3a3f0a14→044f9c3a`, `slideL:9aad293b→044f9c3a`, `slideR:530b633a→044f9c3a`.
- Holds: `still:35be3b67→35be3b67`, `jitter:9e6502d8→05c054ea`, `drift:c6842023→e434e7b3`, `breathe:9d8c3db3→1188137d`, `float:11ad5367→e6eb8367`, `sway:3b4a5814→676796ef`, `pulse:4bf265d4→9adade7a`.
- Exits: `cut:941f0015→941f0015`, `drift:96c74f83→be3638f6`, `wipe:739b96ae→760f906e`, `shrink:4cb96c7a→32c4529c`, `blur:1d9b581c→6f44af32`, `slideOutL:6c8462cc→c7f06bd4`, `slideOutR:485c046d→d71beeaa`.
- Treatments: `none:7d4c278f`, `outline:2d791d9c`, `outlineFill:cc8bd29a`, `glow:0db7dad0`, `underline:f6a7f107`.
- Background and camera: `none:042641ae`; `push:ac6e45b8→0a395676`.

## Supported-group variant matrix

The `variantMatrix` browser fixture uses one behavior-bearing representative from every preset group that currently contains supported JIZURA entries: `style:crimson`, `layout:tySplitType`, `enter:knWordSpin`, `hold:knWordPulse`, `exit:knStackAway`, `decor:tyTextRule`, `treat:knWordPlate`, `bg:none`, `cam:knTiltKick`, `fx:hrPassingShadow`, and `trans:tyRuleWipe`.

Each representative renders the same eight-scenario orthogonal matrix. Every language receives one short and one long case, one landscape and one portrait case, and one overlay and one scene case:

- English short landscape overlay and long portrait scene;
- Simplified Chinese short portrait overlay and long landscape scene;
- Japanese short landscape scene and long portrait overlay;
- Korean short portrait scene and long landscape overlay.

All 88 samples render non-empty content with valid bounds. Every overlay retains transparent pixels, every scene owns a fully opaque canvas, the measured pixel total matches the requested 320×180 or 180×320 surface, and all eight hashes within each preset group are distinct. This is representative group-level visual evidence rather than item-wide proof across every mode. Font resources are non-drawable and carry their separate byte, digest, license, glyph, lifecycle, and build-closure evidence, so the generated full-catalog resource/transparent-mode gate now passes without inventing meaningless font pixels.

## Supported-entry cost benchmark

`script/benchmark-motion-text-renderer.mjs` measures every supported catalog entry in headless Chromium at 1280×720. Each entry receives five warm-up frames and 30 measured frames; the timed region contains frame resolution, Canvas2D drawing, and a one-pixel `getImageData` flush so deferred canvas work is not silently omitted. Animated groups rotate through multiple relevant phases instead of benchmarking one static timestamp. The generated report is `docs/motion-text/jizura-renderer-costs.json`, and `bun run check:motion-text:costs` rejects stale renderer support, missing entries, invalid tiers, or a benchmark below the 720p/30-frame contract.

Cost tiers use p95 thresholds: low ≤ 4.17 ms, medium ≤ 8.33 ms, high ≤ 16.67 ms, heavy ≤ 33.33 ms, and over-budget > 33.33 ms. The current Windows headless-Chromium run measured:

- low: 814 entries;
- medium: 46 entries;
- high: 21 entries;
- heavy: 8 entries;
- over-budget: 0 entries.

The ten slowest current measurements are `fx:defocus` 27.5 ms, `fx:whipBlur` 23.9 ms, `fx:rgbSplit` 19.1 ms, `fx:zoom` 18.2 ms, `exit:shatterLite` 17.9 ms, `fx:echoFrames` 17.5 ms, `exit:explode` 17.0 ms, `exit:glassBreak` 17.0 ms, `fx:bloomFlash` 15.9 ms, and `layout:hrWrongShadow` 15.0 ms.

These are environment-specific renderer microbenchmarks, not end-to-end editor frame times: they exclude video compositing, first-load font parsing, React work, GPU upload, multiple simultaneous clips, and export encoding. The compatibility report therefore closes preset cost evidence for all 889 JIZURA presets. The 23 font catalog entries are resources rather than drawable preset IDs and are correctly marked `not-applicable`; S09 still owns end-to-end p95 validation.

## Evidence

Passed:

- `bun test packages/editor-classic/src/services/renderer/__tests__/motion-text-node.test.ts`: 70/70 tests and 20,647 assertions.
- The manifest-wide smoke test resolves and draws every advertised preset without `unsupported-preset` diagnostics.
- The geometry tests distinguish all 18 layout signatures, including the final slice's clipped captions, kana annotation, split offsets, opacity erosion, vertical ruler, and local 90-degree transform.
- The entrance test records glyph text, clipping rectangles, accent rectangles, scale, translation, color, and settled output. It independently detects the key-glyph isolation, partial wipe, sequential zoom, underline lift, dot substitution, bracket clip, deterministic mistype, and ruby drop signatures.
- The hold test independently detects key-only pulse amplitude, a moving accent reading cursor, outline-only blink windows, and stepped tracking width.
- The exit test independently detects strike collapse, dot replacement, clipped line-feed translation, bracket closure, two-digit index replacement, key-glyph convergence, underline sinking, and horizontal-to-vertical folding.
- The decor test independently detects colophon metadata, running-head/folio geometry, glyph-body guides, clipped repeated text rules, the five-step type specimen, and oversized punctuation.
- The treatment test independently detects one-glyph outline selection, asymmetric head rules, a scaled and raised initial, and per-glyph superscript indices.
- The transition test proves both previous and current cut text participate and distinguishes the ruled-band mask from the denser manuscript-cell mask.
- The treat/transition treatment test distinguishes all 27 source signatures, verifies ten absolute-time treatment changes, and directly checks neon, chrome, karaoke, reflection, and ransom geometry.
- The treat/transition transition test distinguishes all 20 source signatures, proves every intermediate transition consumes both cuts and changes across sampled progress, and directly checks clock, ink, shatter, and pixel geometry.
- The kinetic decor test distinguishes moving trailing lines from a word-clock counter and verifies the counter's exact intermediate `02 / 04` state.
- The kinetic treatment test detects three independent word placements, two scale levels, alternating plate rectangles, and inverted plate text color.
- The kinetic transition test detects opposing corner rotations, hard current/previous frame replacement at two thresholds, and clipped translated strips over the previous cut.
- The kinetic camera test separately detects stepped reading translation, word-triggered dutch rotation, non-uniform card scale, Canvas shear, hard jump-cut scale changes, and a blurred sub-unity rush-in scale.
- The kinetic hold test separately detects active-word pulse amplitude, opposing word rotations, traveling vertical offsets, beat-snap translation, alternating shear signs, and changing inter-word distance.
- The kinetic entrance test separately detects oversized word slam, partial type-in, center replacement, hinge rotation, curved loop travel, partial word push, axis-stretched inertia, rigid word spin, depth-scale dive, and single-axis elastic extension.
- The kinetic exit test separately detects alternating kick directions, word-width push removal, focus-glyph exponential scale, stretched chain launch, accent word blink, alternating-end gap closure, non-interpolated jump stages, and tower fall.
- The kinetic layout test independently detects stacked size contrast, quarter-turn joints, center replacement and full-line resolve, focus dive scale, path-to-grid snap, a rotating seesaw, typed key-word impact, shot-to-shot rhythm cuts, loop-rail glyph rotation, counter-rotating gear plates, two-sided collision squash, boxed tumbling, vertical-to-horizontal reflow, and triggered grid pads.
- The horror style test distinguishes all three palettes. The horror layout test records rectangle alpha and color as well as text/transforms, distinguishes all 12 signatures, and proves each layout changes across two sampled phases.
- Four Horror behavior tests independently distinguish all 7 entrances, 4 holds, 7 exits, and 4 treatments, including mirrored scale, vertical echo, partial reveal, selected-glyph transforms, clipped drain, blackout rectangles, erosion pits, redaction bars, and double-exposure offsets.
- Five Horror environment tests independently distinguish all 7 decors, 4 backgrounds, 2 cameras, 3 screen effects, and 2 transitions, including staged drip growth, perspective corridor frames, branching trees, handheld flinches, dutch snap, explicit signal-loss text, two-cut static replacement, and eyelid closure.
- The deterministic-random range test checks 4,160 seed/salt pairs for both unit and signed bounds.
- The 11×8 Chromium variant matrix covers every currently supported preset group across short/long text, English/Chinese/Japanese/Korean, landscape/portrait, and overlay/scene; each group produces eight distinct hashes with the expected transparent or opaque composition semantics.
- `node script/probe-motion-text-renderer-browser.mjs`: all 18 layouts rendered non-empty output on a transparent Chromium canvas and produced distinct pixel hashes:
  - `tyBandHide`: `e73ee835`
  - `tyBaseline`: `9125e058`
  - `tyCropGiant`: `9f63b1bc`
  - `tyCross`: `38a3282e`
  - `tyErode`: `ce1c677e`
  - `tyFullTrack`: `7d122bb9`
  - `tyIndexTable`: `d19a9d75`
  - `tyJustify`: `cb2f2e02`
  - `tyKeySplit`: `4ec0c4c4`
  - `tyLineFocus`: `b5e05291`
  - `tyMargin`: `48bcfe5a`
  - `tyRotBlock`: `d832c2ae`
  - `tyRuby`: `7b133ab7`
  - `tyScaleSteps`: `d752df7f`
  - `tySplitType`: `b7002895`
  - `tySquare`: `52e28125`
  - `tyStatCount`: `857e0896`
  - `tyVRuler`: `ff2e7152`
- The same Chromium probe renders early and settled pixels for all eight entrances. Every early frame is non-empty on a transparent overlay, the eight early hashes are distinct, and every early hash differs from its settled hash:
  - `tyBracketOpen`: `b7308997` → `4067f513`
  - `tyDotGrow`: `9017ca3e` → `990667a0`
  - `tyKeyFirst`: `16ab3577` → `7310b3be`
  - `tyLineWipe`: `067253af` → `b9af04e6`
  - `tyRetype`: `2470c8ad` → `9c88786a`
  - `tyRubyDrop`: `dbc7cf5e` → `36894b98`
  - `tyUnderLift`: `54cc7ada` → `dc19185a`
  - `tyZoomOne`: `7e0c2537` → `7aed399d`
- The same Chromium probe samples two deterministic phases for all four holds. Both phases render non-empty transparent-overlay pixels, every hold changes across its sampled phases, and the four phase-A hashes are distinct:
  - `tyKeyPulse`: `c31800b6` → `e9383935`
  - `tyReadCursor`: `d1ccf4bf` → `a34a1e2c`
  - `tyOutlineBlink`: `6be4fbfe` → `013dbaf9`
  - `tyTrackStep`: `d7e5d294` → `95dc15b1`
- The same Chromium probe samples two visible deterministic phases for all eight exits. Both phases render non-empty transparent-overlay pixels, every exit changes across its sampled phases, and the eight phase-A hashes are distinct:
  - `tyStrike`: `807c8706` → `b2d7140b`
  - `tyToDot`: `924a2fbc` → `74b94523`
  - `tyLineFeed`: `7903841c` → `3902ea97`
  - `tyBracketClose`: `d058b020` → `27f1c2a8`
  - `tyToIndex`: `aa38d087` → `9159210f`
  - `tyKeyLast`: `386e2159` → `8adc0a78`
  - `tyUnderSink`: `4e055e58` → `9ca6d948`
  - `tyFoldVert`: `fc290b3f` → `ee4c5c21`
- All six decorations render non-empty transparent-overlay pixels with distinct hashes:
  - `tyColophon`: `476bda21`
  - `tyRunningHead`: `d7449614`
  - `tyGlyphBody`: `226b7859`
  - `tyTextRule`: `b820ada2`
  - `tyTypeScale`: `56b2baa5`
  - `tyBigPunct`: `2f334c4d`
- All four treatments render non-empty transparent-overlay pixels with distinct hashes:
  - `tyHollowKey`: `8bc15e36`
  - `tyHeadRules`: `73af68bb`
  - `tyHeadBig`: `8dfe513a`
  - `tyIndexSup`: `eb9042a1`
- Both transitions render the two adjacent cuts at two non-empty transparent-overlay phases; each transition changes across its phases and the transition hashes remain distinct:
  - `tyRuleWipe`: `6f6760cd` → `d47040c7`
  - `tyGridCells`: `cdf940a6` → `c88a41a2`
- Both kinetic decorations render non-empty transparent-overlay pixels with distinct hashes:
  - `knSpeedTrail`: `5cc4264a`
  - `knWordTicks`: `f59b9401`
- Both kinetic treatments render non-empty transparent-overlay pixels with distinct hashes:
  - `knWordScale`: `18e85487`
  - `knWordPlate`: `248a6f0b`
- All three kinetic transitions render non-empty transparent-overlay pixels at two deterministic phases, change across those phases, and retain distinct phase-A hashes:
  - `knCornerSwing`: `f3d242f8` → `e2adee33`
  - `knStutterCut`: `e4fd94ca` → `893bc582`
  - `knStripSlam`: `d0a1ac74` → `7c0e72ca`
- All six kinetic cameras render non-empty transparent-overlay pixels at two deterministic phases, change across those phases, and retain distinct phase-A hashes:
  - `knReadPan`: `261648b9` → `ad03baee`
  - `knTiltKick`: `6b95fc80` → `ce7a3bc2`
  - `knCardFlip`: `1767314b` → `7e102672`
  - `knShearKick`: `b9886045` → `4b403efb`
  - `knJumpCut`: `eac8d0f4` → `053f4d76`
  - `knRushIn`: `5878e16d` → `fdd3887d`
- All six kinetic holds render non-empty transparent-overlay pixels at two deterministic phases, change across those phases, and retain distinct phase-A hashes:
  - `knWordPulse`: `0e169a8f` → `f2cac245`
  - `knCounterRock`: `2cb57b71` → `404560d5`
  - `knWordRide`: `facdce9f` → `2ef05447`
  - `knTickShift`: `567f014b` → `7f21cf16`
  - `knBeatLean`: `c9fc3d1b` → `2ccb113b`
  - `knGapBreath`: `398d2cab` → `faf4645e`
- All ten kinetic entrances render non-empty transparent-overlay pixels at early and settled phases, every entrance changes before settling, and all ten early hashes are distinct:
  - `knWordSlam`: `6316e4e7` → `00dea3b3`
  - `knTypeToSlam`: `81414c73` → `00dea3b3`
  - `knReplaceIn`: `c6d3217d` → `00dea3b3`
  - `knHingeDrop`: `4986bef8` → `00dea3b3`
  - `knLoopIn`: `445ccad5` → `00dea3b3`
  - `knPushIn`: `76cd9d3d` → `00dea3b3`
  - `knInertia`: `b93b0f71` → `00dea3b3`
  - `knWordSpin`: `a12c7b2d` → `00dea3b3`
  - `knDiveIn`: `fe789b0e` → `00dea3b3`
  - `knStretchOut`: `682c6eee` → `00dea3b3`
- All eight kinetic exits render non-empty transparent-overlay pixels at two deterministic phases, every exit changes across those phases, and all eight phase-A hashes are distinct:
  - `knWordKick`: `b33c97b6` → `39e222c3`
  - `knPushOut`: `d3311f84` → `7b4a8042`
  - `knDiveGlyph`: `8d879a9e` → `ff6d11fb`
  - `knLaunch`: `3baaf6b9` → `b76272c9`
  - `knWordBlink`: `3e0cb758` → `a90fafb1`
  - `knCloseGap`: `e8b78384` → `19d089d4`
  - `knJumpCutOut`: `a36864ad` → `56d7b372`
  - `knStackAway`: `80882d98` → `ecf716ef`
- All 14 kinetic layouts render non-empty transparent-overlay pixels at two deterministic phases, every layout changes across those phases, and all 14 phase-A hashes are distinct:
  - `knSlamStack`: `6dfbbd8e` → `889772ab`
  - `knQuarterTurn`: `f6625f8e` → `5142f58d`
  - `knSwapCenter`: `8f7f8acd` → `7005fcef`
  - `knZoomDive`: `b3ed8faa` → `04ec5be3`
  - `knFlowSnap`: `eb099626` → `4275129e`
  - `knSeesaw`: `7b2dba1a` → `4650cad6`
  - `knTypeSlam`: `28d70e1b` → `c056eb4e`
  - `knRhythmCuts`: `5017e68d` → `5e8848fc`
  - `knPathRide`: `d5d7bf7a` → `959b8616`
  - `knGearWords`: `23d28c34` → `4f67290f`
  - `knCollide`: `47f98561` → `35954590`
  - `knTumble`: `48ad3c57` → `7947ccc9`
  - `knReflow`: `0cb318c0` → `8ade7969`
  - `knPadGrid`: `53f3522b` → `abea6411`
- The three horror styles render non-empty transparent-overlay pixels and produce distinct hashes: `hrRuin:cd7eabba`, `hrNightRec:db7acbaf`, and `hrCurse:78f5f9c0`.
- All 12 horror layouts render non-empty transparent-overlay pixels at 18,000 and 66,000 ticks, change across those phases, and retain distinct phase-A hashes:
  - `hrFlashlight`: `ea2e3ce9` → `a09c641d`
  - `hrDoorGap`: `09bdddd3` → `56648fb1`
  - `hrWallScrawl`: `18dedf31` → `f90960d0`
  - `hrCctv`: `f9df942f` → `309df28f`
  - `hrOuija`: `e405b4ee` → `280b30c7`
  - `hrMissing`: `b29fde92` → `1d22b326`
  - `hrWrongOne`: `6752b0b4` → `ac3c27d4`
  - `hrRisingDark`: `6d8c36df` → `b4c455da`
  - `hrRedacted`: `0f1fbb0a` → `c5a0e504`
  - `hrStaticTv`: `b31fff74` → `20d306db`
  - `hrSpiritPhoto`: `66e053c9` → `24cac381`
  - `hrWrongShadow`: `6ef8b524` → `4f1fff21`
- All seven horror entrances render non-empty transparent-overlay pixels at early and settled phases, change before settling, and retain distinct early hashes:
  - `hrBlinkCreep`: `8fcb9fef` → `2d0931c7`
  - `hrJumpScare`: `9038969d` → `b574679c`
  - `hrUneasy`: `7c5a42c9` → `136b4e1d`
  - `hrVhold`: `d10632cf` → `7704f557`
  - `hrMirrorSnap`: `6c5256fb` → `6e37c4d5`
  - `hrManifest`: `a089a993` → `4538ac4c`
  - `hrClawReveal`: `108bde87` → `f6a56ff1`
- All four horror holds render non-empty transparent-overlay pixels at two phases, change across those phases, and retain distinct phase-A hashes:
  - `hrTwitch`: `1ae34120` → `674db467`
  - `hrStare`: `01d61f1a` → `23a419b5`
  - `hrLagOne`: `a3f655b7` → `bb242c66`
  - `hrFlickerLight`: `17fdffaa` → `df795af9`
- All seven horror exits render non-empty transparent-overlay pixels at two visible exit phases, change across those phases, and retain distinct phase-A hashes:
  - `hrPulledDown`: `39914d9a` → `0ae870c8`
  - `hrLookBack`: `7f93e797` → `5b253b84`
  - `hrTurnAway`: `2d7d0cee` → `4d9eabdc`
  - `hrShiver`: `e3d38c48` → `94c9c4d2`
  - `hrSwallow`: `2719406f` → `c09b08b4`
  - `hrFlickerDie`: `ba06a5bc` → `edf61a85`
  - `hrDrain`: `7f77a8ed` → `fc18d758`
- All four horror treatments render non-empty transparent-overlay pixels with distinct hashes: `hrInkBleed:a2527720`, `hrEroded:51e94ec6`, `hrRedact:b7a9c4e5`, and `hrDoubleExp:0c56493e`.
- All seven horror decors render non-empty transparent-overlay pixels at 24,000 and 66,000 ticks, change across those phases, and retain distinct phase-A hashes:
  - `hrScratches`: `80e83ea5` → `5a397083`
  - `hrSigil`: `23607c88` → `5843fda9`
  - `hrWatchEye`: `9dd85f11` → `7b51abb2`
  - `hrStaticPatch`: `1eb47303` → `e85cfd7d`
  - `hrDustBeam`: `26dec4b0` → `f55265b8`
  - `hrDrips`: `a0a7c34d` → `a02a5e85`
  - `hrCracks`: `40940cf1` → `9c6e8d51`
- All four horror backgrounds render non-empty transparent-overlay pixels at two phases, change across those phases, and retain distinct phase-A hashes:
  - `hrFailingLamp`: `4882301b` → `bbd6f08e`
  - `hrCorridor`: `548429ce` → `178b9d19`
  - `hrMold`: `c2cd15a8` → `62e87902`
  - `hrDeadTrees`: `ccc8e6b9` → `62b78c82`
- Both horror cameras render non-empty transparent-overlay pixels and change across their sampled phases: `hrNervous:27d73de3→9416e5f6` and `hrDutchSnap:bc83e42f→4920acb0`.
- All 37 `11p_bgcamB.js` backgrounds render non-empty transparent-overlay pixels, change across their sampled phases, and retain distinct phase-A hashes. Representative pairs include `auroraRibbons:9f475a2d→216775a6`, `seigaiha:575fb4de→df7f53a9`, `starfield:a337dde2→069f42ad`, `filmStrip:252d758c→8194536d`, and `paperCut:a6a51bef→9758c73a`.
- All 12 `11p_bgcamB.js` cameras render non-empty transparent-overlay pixels, change across their sampled phases, and retain distinct phase-A hashes: `orbitDrift:aa7dab2c→cff18285`, `barrelRoll:e7755708→2aae2269`, `pendulumSway:80dcb396→a78870e9`, `focusIn:6f147690→f157a5a9`, `rackFocus:fad55839→02da5b2b`, `earthquake:df4fe1d2→9520b704`, `floatNoise:5b71de06→468b2231`, `vertigo:eeffa4b8→eb88c75e`, `tiltDown:e908cea3→a5a5ce69`, `spiralIn:eb8963a1→31af62f7`, `snapPan:382acdd2→59908f23`, and `jelly:45202734→cffa919c`.
- All 17 newly added `11p_exit.js` holds render non-empty transparent-overlay pixels, change across sampled phases, and retain distinct phase-A hashes. Representative pairs include `shimmer:b9071d54→ec267822`, `hWave:1f41b03d→49fb4bad`, `scanBand:4e692e93→3d9be13a`, `glitchJump:49ed225d→89ad48df`, and `echoTrail:de2ee12d→fd5259c5`.
- All 34 newly added `11p_exit.js` exits render non-empty transparent-overlay pixels, change across sampled phases, and retain distinct phase-A hashes. Representative pairs include `sinkMask:6020e6f6→88c35101`, `trackOutWide:eb6be407→891247fd`, `blurOutStagger:05ed23bd→401a218c`, `backspace:2d7a0ea3→38cb899d`, `burn:85977bf0→c549523b`, and `shatterLite:cb0d8ec8→5100de9a`.
- All 12 `11p_exitB.js` holds render non-empty transparent-overlay pixels, change across sampled phases, and retain pairwise-distinct phase-A hashes. Representative pairs include `glowFlicker:841895a6→e044542e`, `flashBox:d495bef7→5021c0bc`, `glintSweep:26b12259→45bdeff0`, `shadowSway:2191adb4→371d8be3`, and `pluckString:b624e0bf→9f06fea0`.
- All 39 `11p_exitB.js` exits render non-empty transparent-overlay pixels, change across sampled phases, and retain pairwise-distinct phase-A hashes. Representative pairs include `peelOff:aa9a3031→93140ec3`, `glassBreak:1a5aed28→43eb549c`, `matrixOut:802df5cb→ff9b54f6`, `floodOut:bb4f21fa→a473de11`, `mosaicOut:dd37065e→5e0173bc`, and `candleOut:1e231cba→9d71f05e`.
- All 27 `11p_treattrans.js` treatments render visible transparent-overlay pixels and retain pairwise-distinct phase-A hashes. The ten source-semantic animated treatments change across sampled absolute times; representative pairs are `neonOutline:743eff92→bde352d9`, `karaoke:1313546f→200d8723`, `gradientSweep:3c389950→f0e0107d`, and `focusPull:b9687268→b986ae46`.
- All 20 `11p_treattrans.js` transitions render visible transparent-overlay pixels, change across sampled progress, and retain pairwise-distinct phase-A hashes. Representative pairs are `clockWipe:e5217f8f→e608df4f`, `inkBlob:7c6ad347→b37296d5`, `shatterTiles:02332315→bcd88c82`, `flashCross:487163e2→a302c454`, and `pixelate:aab9f737→39701180`.
- All 15 `07_decor.js` entries render non-empty transparent-overlay pixels, change across sampled phases, and retain distinct phase-A hashes: `grid:84f38c0f→00783a72`, `stripes:ad6b9179→c51faaf1`, `blobs:f24a0558→e9792a9c`, `bars:a0fd46e9→0414094f`, `shapes:930174f6→d8bbd78f`, `counter:0f7704a8→19b80914`, `brackets:6bf840ca→9c817586`, `rings:a8adefee→1e5d3373`, `dots:f0a7ba33→f8d4d866`, `arrows:eba3ad5b→55ec9ea1`, `slash:0f12495e→f65f9ba9`, `sparks:44402fd0→604f757c`, `leaders:682c3302→73e042ee`, `waveform:56d6d2b6→0e0e061f`, and `barcode:8f044f47→163809e9`.
- All 45 `11p_decor.js` entries render non-empty transparent-overlay pixels, change across sampled phases, and retain pairwise-distinct phase-A hashes. The full pairs are recorded in the source-family section above and the generated browser-probe output; the recording-context test also proves the nine back-layer and 36 front-layer entries keep their source ordering around the lyric.
- All 55 `11p_decorB.js` entries render non-empty transparent-overlay pixels, change across sampled phases, and retain pairwise-distinct phase-A hashes. The full pairs are recorded in the source-family section above and the generated browser-probe output; the recording-context test also proves the eight back-layer and 47 front-layer entries keep their source ordering around the lyric.
- All 20 newly supported `11p_looks.js` treatments render visible transparent-overlay pixels and retain pairwise-distinct phase-A hashes. The nine source-semantic animated treatments change across sampled phases; the other eleven remain stable by design.
- All 24 `11p_looks.js` backgrounds render visible transparent-overlay pixels, change across sampled phases, and retain pairwise-distinct phase-A hashes.
- All 15 `11p_looks.js` cameras render visible transparent-overlay pixels, change across sampled phases, and retain pairwise-distinct phase-A hashes.
- All 24 `11p_looks.js` screen effects execute the real Canvas pixel path, retain overlay transparency, change across sampled phases, and retain pairwise-distinct phase-A hashes. The recording-context fallback independently distinguishes the same 24 IDs without requiring pixel capture.
- All 19 newly supported style palettes render visible transparent-overlay pixels and pairwise-distinct hashes: `magenta:50ff99df`, `hud:85932210`, `mint:fa051fdc`, `specimen:58facd6a`, `transit:05b0b097`, `blueprint:d06725a2`, `rouge:371bc2c4`, `sakura:f79dc529`, `ocean:7029cc7e`, `sunset:69f9b634`, `forest:1ce57759`, `vapor:60ab59fe`, `newsprint:1d574ed4`, `synth80:a26e4f27`, `kraft:5ca889ef`, `candy:43a47bac`, `acid:ad6e4b56`, `sumi:25ad954d`, and `gold:87acfb88`.
- All 17 newly supported `05_anim.js` recipes render visible transparent overlays, change across sampled phases, and retain phase-A hashes distinct within their groups. Entrance pairs are `assemble:880cf6c3→dadb4a9d`, `slice:88d5e272→a9ed2fcb`, `type:f225c6b5→f4278a32`, `drop:b065e7ff→fe3975fb`, `stretch:270aa39e→2a5d7ff3`, `spin:aca41d67→e71062c6`, `flicker:eb88dc1a→4ab08d76`, `scramble:b8aba518→baf940e5`, and `zoom:a85745ee→770c8d2f`; hold pairs are `wave:73eb2c38→3e7bced9` and `glitchtick:30bc5306→b18fb346`; exit pairs are `explode:bf0922e8→4cf57aa4`, `fall:5777d51b→41ee3da9`, `slice:acaecebd→55765f28`, `stretch:fe463739→83a4555a`, `scatter:ea5336b6→7a1971b1`, and `glitch:27deeae2→a5abaae2`.
- All 12 newly supported `06_layouts.js` layouts render visible transparent overlays and retain pairwise-distinct phase-A hashes. The source-semantic static `scatter` and `condensed` layouts remain stable while the other ten change across sampled phases: `tile:7091659a→f149a0d8`, `scatter:26f65a5c→26f65a5c`, `ring:c00054fb→f700edcd`, `wave:aecfd7de→865c1561`, `labels:b71b299a→258f3efd`, `condensed:7833b340→7833b340`, `gloss:08dc59f0→8c83d600`, `diag:027f8a8f→47d51a75`, `circle:f6bc954d→e22b09df`, `pill:cd169855→e9a36063`, `title:3a82dda8→803f8b00`, and `interlude:c3b7b5c6→dfa2e036`.
- All 28 newly supported `11p_layoutsA.js` layouts render visible transparent overlays, change across sampled phases, and retain pairwise-distinct phase-A hashes. The full pairs are recorded in the source-family section above and the generated browser-probe output.
- All 27 newly supported `11p_layoutsB.js` layouts render visible transparent overlays, change across sampled phases, and retain pairwise-distinct phase-A hashes. The full pairs are recorded in the source-family section above and the generated browser-probe output.
- All 34 newly supported `11p_layoutsC.js` layouts render visible transparent overlays, change across sampled phases, and retain pairwise-distinct phase-A hashes. The full pairs are recorded in the source-family section above and the generated browser-probe output.
- All 34 newly supported `11p_layoutsD.js` layouts render visible transparent overlays, change across sampled phases, and retain pairwise-distinct phase-A hashes. The full pairs are recorded in the source-family section above and the generated browser-probe output.
- All 47 `11p_enterB.js` entrances render visible transparent overlays, change across sampled phases, and retain pairwise-distinct phase-A hashes. Representative pairs are `springIn:d8f43383→5953dfcd`, `pendulum:2a9514ff→65cf8d03`, `splitFlap:713b3e77→f1236104`, `filmFeed:990fd419→a61e1ea9`, `dither:d08f459f→7d87caba`, `matrixRain:8034fd87→0dd4bdd8`, `clockWipe:e61cbda4→c06632ec`, and `tokoroten:356ed424→832f3971`.
- All 38 newly supported `11p_enter.js` entrances render visible transparent overlays, change across sampled phases, and retain pairwise-distinct phase-A hashes. Representative pairs are `riseMask:db30a0b6→514482e4`, `flipX:7ecc05e3→54b2e80c`, `strokeDraw:07133c4b→89c03670`, `checker:4a4d9483→550fec87`, `bounceBig:427976ee→e9100c3c`, `glitchIn:a5e5f1a0→330c0455`, `spiralIn:eaa6c672→e3d738a4`, and `neonOn:f28b2475→4e1969f6`.
- All 34 `11p_fxB.js` screen effects execute the real Canvas pixel path, retain overlay transparency, change across sampled phases, and retain pairwise-distinct phase-A hashes. Representative pairs are `radialChroma:7c640a65→7cd21847`, `halftone:179fddc7→95b4420c`, `bandInvert:55f17b33→b9572f0c`, `kaleido:14f148e3→f3fb9703`, `shatter:f98a0202→9f0cbaf0`, `snapshot:9c968217→37671fa8`, and `loopScroll:535b17f7→8a8662aa`; recording-context fallback signatures independently distinguish the same 34 IDs.
- All three horror screen effects render non-empty transparent-overlay pixels, change across phases, and retain distinct phase-A hashes: `hrSubliminal:b40f137a→832914f1`, `hrSignalLoss:857df14a→ba04bb19`, and `hrPassingShadow:33d40b12→d772f6c6`.
- All eight core screen effects render non-empty transparent-overlay pixels, change across phases, and retain distinct phase-A hashes: `chroma:ea38f682→f9f3d86f`, `shake:124ad715→054c09b2`, `slice:cdc0bed8→a5edd7cc`, `block:880aa79f→11b197a3`, `invert:39d1c9df→42fd12e3`, `flash:d595075f→06686c39`, `zoom:9d74c78f→1cd4b108`, and `mosaic:3ae35bda→5b91a82e`.
- The core-effect phase-A frames are byte-identical between HTMLCanvas and OffscreenCanvas, covering the editor fixture and production compositor surface types.
- Both horror transitions contain visible two-cut output, change across phases, and remain pixel-distinct: `hrStaticCut:3fa413db→d9f77d36` and `hrBlink:0460916a→ccc75d6f`.
- The same browser probe retained its deterministic seek, seed isolation, language isolation, scene opacity, preview/export parity, compositor texture refresh, font lifecycle, and Rust planner-support checks.
- `bun run check:motion-text:presets`: 912 entries classified, 912 supported, zero pending.
- `bun run check:motion-text:costs`: all 889 supported presets have a current 720p/30-frame cost measurement.
- `cargo test -p motion-text --lib`: all 75 Rust tests pass, including source-family filtering, repeated-line exact reuse and stable seed, center-free splitting, full-lock snapshot preservation, planning-control mutations, precise lock mutations, scoped restyle/inheritance preservation, preset-preview support/transition validation, JIZURA v1 fixture import, fail-closed future/malformed input, external-resource isolation, parsing, SHA-256, role sharing, and declared Japanese/English/zh-Hans glyph coverage for all 19 unique TTFs.
- The contract, lock-state, font-language, and catalog suites pass 27 tests; the canonical factory seam passes 20 tests, including precise lock add/remove, the zh-Hans default-asset resolution and real canonical-WASM calls. The font catalog/runtime suites pass six tests for 23 roles, 19 shared assets, OFL files, built-in paths, digest/glyph validation, bounded caching, and release behavior.
- `node script/probe-jizura-import-fixture.mjs`: PASS against the original JIZURA `J.plan` runtime for language, metadata, duration, cue timing, and the fixed line/cut preset selections.
- `node script/probe-jizura-import-ui.mjs`: PASS through the real editor UI and canonical WASM, including compatibility/resource messaging, transaction insertion, revision r0, and durable reload.
- `node script/check-wasm-api-surface.mjs`: PASS for the rebuilt canonical artifact and its 59-wrapper/76-stable-export ABI; earlier path/init evidence remains valid and the installed-copy mismatch remains intentionally unsynchronized.
- `node script/probe-motion-text-preset-catalog.mjs`: PASS for 889 entries, bounded DOM/card count, four-preview concurrency, virtual-scroll replacement, tab cleanup, and project replacement.
- `node script/probe-motion-text-locks.mjs`: PASS through real Chromium and canonical WASM for single-transaction lock mutation, undo/redo, durable reload, locked-group variation preservation, full-cue gating, cut-only gating, and parameter lock add/remove; the final sequence revision is r2.
- `apps/vite-example` typecheck and build pass; the build still resolves the older installed WASM copy, which is recorded as a delivery-sync blocker rather than import evidence.
- The renderer suite passes 72 tests and 20,660 assertions, including the adjacent-cut font/palette fixture and deterministic center-free side-band drawing.
- The real Chromium font probe digest-verifies and loads the shipped Noto Sans JP asset, waits for `document.fonts.ready`, renders it, and removes the face on release.
- The Vite editor build manifest contains all 19 TTFs and 19 OFL notices: 38 files and 117,539,061 bytes.
- Focused Prettier and ESLint checks pass for the renderer, tests, support manifest, and browser probe touched by this slice.
- A strict targeted TypeScript check passes for the typography, kinetic, horror, core FX, complete bgcam background/camera, complete `11p_exit.js` and `11p_exitB.js` hold/exit families, complete `11p_treattrans.js` treatment/transition family, complete `11p_enterB.js` and `11p_enter.js` entrance families, complete `07_decor.js`, complete `11p_decor.js`, complete `11p_decorB.js`, complete `11p_looks.js` and `11p_fxB.js`, 27/27 style palette, complete `05_anim.js`, complete `06_layouts.js`, complete `11p_layoutsA.js`, complete `11p_layoutsB.js`, complete `11p_layoutsC.js`, and complete `11p_layoutsD.js` slices, their shared/runtime types, `runtime.ts`, `draw.ts`, and `support-manifest.ts`.

The broad `apps/web` TypeScript invocation remains red on existing workspace setup and unrelated baseline errors, including duplicated root/app Next types, missing `bun:test` declarations, and pre-existing test fixture type conflicts. The focused renderer check above separates this slice from that repository-wide blocker.

The compatibility report records 889 item-scoped Chromium preview fixtures, covering every drawable JIZURA catalog preset: the 101 Batch B typographic and kinetic entries, the 39 earlier baseline entries, all 55 entries from the completed Batch C horror pack, all eight built-in FX from `05b_registry.js`, all 49 backgrounds/cameras from `11p_bgcamB.js`, the 51 newly completed hold/exit entries from `11p_exit.js`, all 51 holds/exits from `11p_exitB.js`, all 47 treatments/transitions from `11p_treattrans.js`, all 47 entrances from `11p_enterB.js`, the 38 newly completed entrances from `11p_enter.js`, all 15 entries from `07_decor.js`, all 45 entries from `11p_decor.js`, all 55 entries from `11p_decorB.js`, all 83 newly completed `11p_looks.js` entries, all 34 entries from `11p_fxB.js`, the 19 newly completed style palettes, the 17 newly completed `05_anim.js` recipes, the 12 newly completed `06_layouts.js` layouts, all 28 `11p_layoutsA.js` layouts, all 27 `11p_layoutsB.js` layouts, all 34 `11p_layoutsC.js` layouts, and all 34 `11p_layoutsD.js` layouts. The 23 font resources add non-pixel resource evidence. Global gates currently read:

- all catalog entries classified: pass;
- all advertised supported entries have runtime smoke evidence: pass;
- all supported catalog entries have applicable preview or resource evidence: pass;
- all supported preset groups have representative variant-matrix evidence: pass;
- all supported catalog entries have applicable cost evidence: pass;
- all costs measured: pass;
- all transparent modes verified or marked not applicable across the catalog: pass.

## Complete catalog browser and bounded previews

The Motion text asset panel now derives its catalog directly from `MOTION_TEXT_RENDERER_SUPPORT`, removes the five Rocut-native compatibility aliases, and exposes exactly 889 JIZURA drawable presets. Stable `group:id` identity remains separate from humanized display names. Search covers both forms, and group filters cover all 11 preset groups.

`preset-virtualization.ts` fixes the browser at two columns and 132-pixel rows. It mounts only visible rows plus two-row overscan and designates at most four visible entries as active previews. `IntersectionObserver` suspends all preview work when the catalog itself is outside the enclosing asset-panel viewport. Filtering resets the local scroll position instead of retaining an invalid virtual window.

The new Rust `create_motion_text_preset_preview` boundary validates renderer support, creates a deterministic two-cue clean-caption skeleton, and applies the requested preset to defaults and resolved cuts. Transition previews preserve an adjacent-cut seam by explicitly disabling the transition on the first cue/cut and applying it from the second cue onward. React receives a contract-valid sequence and never constructs or edits its resolved plan.

Each active preview samples an explicit absolute-time window: entrance, hold, exit, and transition groups target their relevant cut phase; other groups loop through the middle of the first cut. Every animation frame calls `resolveMotionTextRenderFrame` with sequence time. Leaving the active window, filtering, switching tabs, replacing the project, or unmounting cancels the RAF and clears the canvas; inactive cards do not mount canvas elements.

Evidence:

- Rust preset-preview tests pass for supported scalar application, unsupported rejection, and transition seam placement; the motion-text crate now passes 68 tests.
- The strict TypeScript seam accepts the canonical factory output and rejects malformed payloads; the focused factory/catalog suites pass 22 tests and 106 assertions.
- `script/probe-motion-text-preset-catalog.mjs` passes in real Chromium with canonical WASM: 889 catalog entries, 10 mounted cards at the first viewport, no more than four active canvases, changed card identity after a 13,200-pixel virtual scroll, seven cancellation calls on tab teardown, and no old-project catalog after project replacement.
- Built-in font references now carry Rust catalog `supportedLanguages`; the contract validates unique language tags, legacy/external refs remain explicitly unknown, and the same Chromium probe verifies a real `zh-Hans` sequence displays the declared Japanese/English coverage gap instead of treating fallback glyphs as fidelity.
- Focused ESLint and Prettier checks, Vite example typecheck/build, and the canonical WASM API gate pass. The build warning about the pre-existing countries-data split and large chunks is unchanged.

## Advanced locks, inheritance, and cross-style transition fidelity

Rust now exposes one `set-cue-lock` mutation for four scopes: whole cue, stable cut, preset group, and parameter. It validates cue/cut ownership, parameter existence, and the exact scope/key vocabulary; add/remove is exact, deduplicated, stably sorted, and increments the sequence revision once while rebuilding the resolved plan. A whole-cue lock protects all cue fields. Cut locks protect text edits and adjacent cut boundaries that would invalidate stable cut identity. Preset-group locks protect only their style field, and parameter locks remain independently editable. Sequence restyle and inheritance restoration update unlocked fields while retaining the locked resolved snapshots, so a scoped lock no longer freezes unrelated timing, font, color, or text controls.

React presents those Rust-owned semantics through `Locks & inheritance`: users can toggle the whole cue, all preset groups, all parameters, one group, one stable cut, or one parameter. Every editable field reports `Locked`, `Local`, or `Inherited`, and disabling is field-specific. The real Chromium lock probe verifies the transaction, undo/redo, reload, variation preservation, full-cue gate, cut gate, and parameter lock editing without constructing a plan in React.

The renderer now resolves adjacent-cut font and palette values independently. `MotionTextRenderFrame` carries `previousFont` and `previousPalette`; transition drawing uses those values for the previous vector callback, and the frame fingerprint includes both adjacent styles. The 71-test renderer suite proves a mixed-font, mixed-palette transition draws the previous and current cut with their own resolved values.

The Vite editor-asset plugin now resolves the runtime allowlist once for both dev serving and production emission. Its dev middleware accepts only exact allowlisted GET/HEAD paths, honors the configured base, streams the source file with an explicit MIME and length, and leaves all other requests to Vite. The real-server regression proves `/motion-text/fonts/noto-sans-jp-variable.ttf` returns `font/ttf`, 9,589,900 bytes, magic `00 01 00 00`, and SHA-256 `c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f`; HEAD reports the same metadata with no body. The independent production checker now includes `motion-text/fonts`, and the emitted URL audit treats `/motion-text/` as first-party. After a production build, all 334 copied files totaling 104,243,573 bytes pass MIME, byte, SHA-256, category, graph-completeness, and excluded-path checks; both checker negative-control suites and the runtime asset boundary remain green.

`script/probe-motion-text-ui.mjs` is now fully green through the same font transport and parsing path. The zh-Hans resource slice packaged the digest-pinned `gothic_bold_zh_hans` variant (Noto Sans SC) with its OFL notice, declared only its measured coverage, and reran the complete export/抽帧 probe: the runtime no longer rejects the 12-cue zh-Hans F01 text, and preview/export frame comparison records MAE 4.8332/255. Substituting an ambient system font or weakening the missing-glyph gate remains unacceptable, and `ko`/`zh-Hant` still fail closed.

## Source-family planning controls, unified look, and center-free rendering

`script/audit-jizura-registry.mjs` now emits `rust/crates/motion-text/resources/jizura-planner-catalog.json` directly from each JIZURA definition's authoritative `set` field. The planner catalog contains 887 selectable entries: 731 ordinary, 55 Horror, 50 Typography, and 51 Kinetic. It is an execution projection of the complete 912-entry audit catalog, not a replacement catalog identity. The full audit catalog remains SHA-256 `9ec6f3be1a297152ccd377456348900fe0f4cc3b7629d21ec319976740f33d12` and continues to back `JIZURA_CATALOG_HASH`; the planner projection is SHA-256 `7fd1b885e17538b70b55feffed918f4af5b6c220d4023a76a472f8aa7936323b`. IDs are never classified by prefix.

Rust now owns `planningControls` in the sequence document. JIZURA defaults are Horror off, Typography on, Kinetic on, unified look off, center-free off, and portrait direction top/bottom. `serde(default)` and the TypeScript boundary keep old schema-v1 documents readable. The canonical `update-planning-controls` mutation writes the controls, increments revision once, and rebuilds the plan. Family switches filter only randomized candidates; explicit selections and every lock scope remain authoritative.

Unified look uses a bounded section palette, paired direction alternation, and impact/kime candidates. Repeated normalized lines reuse the first occurrence's complete visual snapshot: preset, parameters, font, and stable seed. Local cue overrides still win. Center-free planning splits each cut's text in Rust and writes one `jizura.centerFree` parameter object containing `enabled`, `direction`, `firstText`, `secondText`, and `delayTicks`. The renderer draws the two text halves from absolute cut-local time into left/right bands for landscape output and top/bottom or left/right bands for portrait output. Backgrounds and full-screen effects retain their existing whole-frame scope; React and Canvas own no independent timing or split truth.

The `.jizura.json` importer now maps `horror`, `typo`, `kinetic`, `unify`, `centerFree`, and `centerDir` into native planning controls and reports them as `planning-control-preserved`; the earlier provenance-only warning is removed. The properties panel exposes Typography, Kinetic, Horror, Unified look, Keep center clear, Top/bottom, and Left/right, with every interaction routed through the Rust mutation.

Focused verification on 2026-09-28:

- `cargo test -p motion-text --lib`: 75/75 pass.
- `bun test packages/editor-contracts/src/__tests__/motion-text.test.ts`: 18/18 pass; legacy omission remains valid and malformed controls fail validation.
- `bun test packages/editor-classic/src/wasm/__tests__/motion-text-factory.test.ts`: 20/20 pass through the rebuilt canonical WASM, including the single-revision planning mutation.
- `bun test packages/editor-classic/src/services/renderer/__tests__/motion-text-node.test.ts`: 72/72 pass with 20,660 assertions, including center-free bands.
- Focused Prettier, ESLint, and `bun x tsc --noEmit -p apps/vite-example/tsconfig.json`: pass.
- `script/probe-motion-text-planning-ui.mjs`: pass in real Chromium through canonical WASM and BrowserProjectStore. It verifies default control state, exact +1 revision per toggle, repeated-line snapshot reuse, center-free parameters, Horror exclusion from variation while disabled, and full-cue lock preservation after replanning. Its 550×309 preview recorded 1,950 changed pixels in the left text band, zero in the center band, and 1,985 in the right text band.
- `script/probe-motion-text-browser.mjs`: Node and Chromium parse/plan/tokenize/clip-time results remain identical.
- Canonical WASM path, API-surface, and runtime-init gates pass. The rebuilt binary is 5,511,220 bytes with SHA-256 `14de620a1bfa38228a43e4103cc557ae7a27bbb30185bfffae91b17d685e75a8`; the callable surface remains 59 JS exports, 76 stable binary exports plus three compiler trampolines, and 612 imports. The `gothic_bold_zh_hans` language asset changes no public export.
- `check-wasm-source` remains intentionally red because root and `apps/web` resolve installed binaries different from the canonical build. No installed copy was modified.
- The full F01 UI/export probe now passes with the glyph gate intact: the Rust resolver selects the `gothic_bold_zh_hans` variant (Noto Sans SC), the shared readiness audit reports zero missing codepoints, and preview/export frame comparison records MAE 4.8332/255. The gate was not weakened.

## Remaining G7/M2 work

- Keep the completed 101/101 Batch B matrix and 11×8 supported-group matrix green while the remaining editor work changes loading and catalog presentation.
- Keep all 889 preset cost tiers current; full editor/compositor/export p95 work remains in S09.
- Keep the digest-pinned zh-Hans offline font (`gothic_bold_zh_hans` → `noto-sans-sc-variable.ttf`) in the coverage/license/package accounting and keep the full UI/export probe through MP4 metadata and frame comparison green.
- Expose the frozen motion-text create/read/edit/variation/planning-control operations through the Rocut CLI, then update the Rocut plugin and Creator Studio to consume those public operations rather than writing project JSON.
- Complete S09 editor/compositor/export regression and the mixed user/Agent transaction scenario using final packaged artifacts.
- Synchronize the rebuilt canonical WASM through the normal dependency workflow when authorized, then rerun the aggregate WASM/source and installed-entry checks. Do not replace installed files by hand.
- Treat Chinese/Korean offline font mapping as a separate, explicit resource slice if product fidelity requires it; do not silently widen the current language declarations.

The catalog, resource/accounting, `.jizura.json` import, bounded preview, advanced lock/inheritance, cross-style transition fidelity, source-family switches, unified/repeat-history planning, center-free slices, and the zh-Hans font resource decision are complete. G7/M2 remains open on end-to-end S09 evidence and final dependency/installed-artifact closure; none of the focused green checks above substitutes for installed-artifact acceptance.
