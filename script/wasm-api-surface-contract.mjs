/**
 * The recorded wasm surface.
 *
 * Refreshed 2026-10-11 from the pinned authoritative rebuild, not an installed shared copy.
 * Source manifest: d6cb235399f0090d037eb1c6d8c10241c8042d1d2b16913e56c6dc7a08e207c0.
 * Reviewed 25 public JS / 95 stable binary additions, zero old stable removals; see
 * docs/evidence/wasm-authority-20261011.json for frozen-source origins and the retained red
 * baseline. This records ABI/entries, not browser raster or installed Electron acceptance.
 *
 * **How to re-derive every value here**, so a reader can check rather than trust:
 *
 *     node script/build-wasm.mjs                 # on the pinned toolchain (rust-toolchain.toml
 *                                                # + WASM_PACK_VERSION); build-wasm refuses otherwise
 *     sha256sum rust/wasm/pkg/*                  # pinnedHashes, and the dts/wrapper/wasmDts values
 *     node script/check-wasm-api-surface.mjs     # reports every value that has moved, by id
 *
 * **Why the pins matter to this file.** The early surface included three rustc symbol-hash names
 * and the binary's `producers` section carries the compiler version verbatim, so an unpinned
 * toolchain moves this contract without anyone touching the source. That is what happened on
 * PR #2: CI installed `wasm-pack: latest` (v0.15.0) and the runner image's rustc against a surface
 * recorded with wasm-pack 0.13.1 / rustc 1.88.0, and the gate reported `wasm-exports`,
 * `binary-declarations` and `package.json` deltas that no commit had caused.
 *
 * **The LICENSE and README values were checkout-dependent, which took two attempts to see**
 * (2026-08-16). First reading: they were "stale CRLF-era recordings" — true as far as it went,
 * since `sha256(crlf(LICENSE)) = 8117f9bb…3f59d3d` and `sha256(crlf(rust/wasm/README.md)) =
 * a09d7957…6b4d3191` are exactly the values this file used to carry. The conclusion drawn from
 * that — "generated-by-copy, therefore platform-independent" — was **wrong**, and CI proved it one
 * round later: re-recorded as LF bytes, the gate failed on `build (windows-latest)`, whose runner
 * checks out with git's `core.autocrlf` ON and therefore hands wasm-pack CRLF files to copy.
 *
 * The right reading is that these are the only two files wasm-pack COPIES rather than generates,
 * so their bytes are a property of the checkout, not of the artifact. They now live in
 * `pinnedTextHashes` and are compared on content. Both directions of the mistake are kept on
 * record there, because a contract that only shows its final answer teaches nobody why it is
 * shaped that way.
 */
export const API_GATE = "script/check-wasm-api-surface.mjs";
export const BASELINE_DTS_SHA =
	"07e195eb8e750a6980aaad9c6d9c1c1376e9e0b282dfc387d8c1ecbf8c89278a";

/**
 * The compiler-generated closure trampolines, matched by SHAPE rather than by exact name.
 *
 * **This is a deliberate, measured re-scope — the one place this contract is not byte-exact.**
 *
 * wasm-bindgen emits one of these per closure signature, and rustc's legacy symbol mangling ends
 * each name with a 16-hex hash. That hash is derived from cargo's `-Cmetadata`, whose inputs
 * include the **host** triple — so it moves between build hosts even when everything the contract
 * pins is identical. Measured on PR #3, CI run `31940776057`, with both pins confirmed applied
 * (`rustc 1.88.0 (6b00bc388)` — the same commit hash as the recording machine — and
 * `wasm-pack v0.13.1`):
 *
 *   windows (recorded)          linux (CI)
 *   …invoke__h6e68ca372e8bf468  …invoke__h276a4a183af50bac
 *   …invoke__h755062247edbbf0a  …invoke__h3a4584f6e44c7108
 *   …invoke__hf7fc07325ff431aa  …invoke__hc1daa042eeabb391
 *
 * Exactly 3 in, 3 out, total unchanged at 78, and **all 75 other exports identical**. The gate
 * printed that difference itself; the re-scope was written only after seeing it, not from the
 * hypothesis that preceded it.
 *
 * `UPSTREAM.md` § WASM rebuild correspondence had already established the same rule for the
 * published-vs-self-built comparison — "stripping the hash makes the two sets identical, and they
 * correspond 1:1" — so this applies the repository's own existing finding to its gate.
 *
 * **What is still asserted, so this is a re-scope and not a hole**: the count of trampolines is
 * exactly `trampolineExportCount`, each must match this shape, and all 222 stable exports remain
 * an exact set (226 total). The 2026-10-11 rebuild adds the FnMut() readback timer adapter;
 * its frozen-source/glue provenance is in docs/evidence/wasm-authority-20261011.json.
 * A 5th trampoline, a missing one, a renamed stable export, or a stable
 * export disguised in this shape all fail — each with a committed negative control.
 */
export const TRAMPOLINE_EXPORT =
	/^wasm_bindgen__convert__closures_____invoke__h[0-9a-f]{16}$/;

/** The generated non-bundler entry emitted by `script/build-wasm.mjs` (`emitSyncEntry`). */
export const SYNC_ENTRY = "opencut_wasm_sync.js";
/** The wasm-pack `--target bundler` entry, untouched by the emission step. */
export const BUNDLER_ENTRY = "opencut_wasm.js";

export const EXPECTED = {
	files: [
		".gitignore",
		"LICENSE",
		"NOTICE",
		"README.md",
		"opencut_wasm.d.ts",
		"opencut_wasm.js",
		"opencut_wasm_bg.js",
		"opencut_wasm_bg.wasm",
		"opencut_wasm_bg.wasm.d.ts",
		"opencut_wasm_sync.js",
		"package.json",
	].sort(),
	/**
	 * Files whose exact bytes are pinned. `.gitignore`, `LICENSE` and `README.md` are copied by
	 * wasm-pack; `package.json` is wasm-pack's manifest after `emitSyncEntry` adds the `exports`
	 * conditions; `opencut_wasm_sync.js` is that emission's own output.
	 */
	pinnedHashes: {
		".gitignore":
			"684888c0ebb17f374298b65ee2807526c066094c701bcc7ebbe1c1095f494fc1",
		"package.json":
			"60502f95b49df31dd41e5be0ada1826e0693b30a525d3b49da73f4e106a1a4b4",
		[SYNC_ENTRY]:
			"3ea9403a7e21fb5c1228062c356fad1843cc461822c57342b942aa3e96b84c17",
	},
	/**
	 * `LICENSE` and `README.md` are copied by wasm-pack; `NOTICE` is copied by the
	 * emission step. Their bytes carry the *checkout's* line-ending configuration, not a
	 * property of the artifact. They are hashed after normalising CRLF to LF: the pin is on their
	 * CONTENT.
	 *
	 * **Byte-pinning them was the wrong instrument from the start, and both directions of the
	 * mistake are now on record.** The values this contract carried until 2026-08-16 were
	 * `8117f9bb…` / `a09d7957…` — exactly `sha256(crlf(…))` of these files, recorded on a checkout
	 * with git's `core.autocrlf` ON. They were re-recorded here as the LF bytes from a checkout
	 * with it OFF, and PR #3 round 4 immediately failed on `build (windows-latest)`, whose runner
	 * checks out with `autocrlf` ON:
	 *
	 *     generated-files: LICENSE differs from the recorded build output
	 *     generated-files: README.md differs from the recorded build output
	 *
	 * Neither recording was wrong for its machine; both were wrong as a contract term. The
	 * normalised hash is the same value on every checkout.
	 *
	 * Still asserted: the exact content. One changed character fails (`edited-license` control),
	 * and `check-wasm-source.mjs` independently asserts `rust/wasm/LICENSE` is byte-identical to
	 * the root `LICENSE` within a checkout.
	 */
	pinnedTextHashes: {
		NOTICE: "1111d13303b79967e726d09b1ca99d9183dea59e8e8343ceaccfa18a8bc11fe4",
		LICENSE: "814632368a8331fd1f485f4bd4b7ecb6401e5f2a24fba79cd3e21aff8ca39a6e",
		"README.md":
			"c8fe27ab5d2e12963e1f04571549afc9828060f4dfec85e6afaa188d3d90a128",
	},
	changedBaselineHashes: {
		"opencut_wasm.d.ts": BASELINE_DTS_SHA,
		"opencut_wasm.js":
			"81bbfdfed6c0e121a8791c0c356e71301cc3614dd8341cbd3b7b6a613f339d3b",
		"opencut_wasm_bg.js":
			"b0b80cb36443bf768be6cfcb2ad77a7f3b4cdc68b4a89b1f6fc519f2b39e6b2a",
		"opencut_wasm_bg.wasm":
			"56cb9ab6ac1fc8df955a716c01f9ed47d836aba3b1f5ccc6372a155c239c3eee",
		"opencut_wasm_bg.wasm.d.ts":
			"d19c1b3dc87f095040c7eb1e56eb8c965d587cf7927ca21cc513327cf78ed7c1",
	},
	dtsSha: "c1c554ea5726a473810b4c632d9d7cf26885837a4957ea44a67643cdf3ac88bc",
	wrapperSha:
		"d09bc88e6ed7a1af99adf7a1e545346e7993a8500cd78e519f9b0b0b17a6aabf",
	/**
	 * The low-level declarations, hashed after normalising the trampoline hashes below and sorted
	 * by line. Exact-byte hashing of this file cannot hold across build hosts for the reason
	 * documented at `TRAMPOLINE_EXPORT`; every other line is still compared verbatim, and the line
	 * count is pinned, so an added, removed or edited declaration is still caught.
	 *
	 * Recorded on Windows; the value is host-independent by construction. Re-derive with the
	 * hashing recipe in `script/check-wasm-api-surface.mjs` after a pinned WASM rebuild.
	 */
	wasmDtsNormalizedSignature:
		"6689fe16269dc2da9a5b459f555e6b50a064f364ad1e02dfa391cebcbf84301b",
	wasmDtsLineCount: 228,
	wrapperExportSignature:
		"3700daef9601dc5225f499ca86b85e8eaf8381d7a5d40313f21b330eb8b0167a",
	wrapperExportCount: 135,
	bgExportSignature:
		"3b38e0d1e79401bbc51e2b1991cf1b52dc3d5caa603a43ac33329d6a76e61c27",
	bgExportCount: 755,
	/**
	 * The stably-named binary exports, as an exact set. This is the real contract: every export
	 * a consumer can name is pinned here, and any addition, removal or rename fails.
	 *
	 * The remaining 4 are compiler-generated closure trampolines whose names carry a rustc symbol
	 * hash — see `TRAMPOLINE_EXPORT` for why they are matched by shape and count instead.
	 */
	stableWasmExportSignature:
		"f087380708606fd6bd9e09fa46ee61c4ef2ddc012ee321a64e6998afb5f47775",
	stableWasmExportCount: 222,
	trampolineExportCount: 4,
	/**
	 * The whole export set as recorded on the Windows build machine, kept for diagnosis: on
	 * failure the gate prints the symmetric difference against it, which is how the host-varying
	 * trampolines were identified in the first place (CI run 31940776057). It is NOT the
	 * assertion — `stableWasmExportSignature` is.
	 */
	wasmExportsAsRecorded: [
		"beginRenderFrameForHandle|function",
		"advanceRenderFrameForHandle|function",
		"commitRenderFrameForHandle|function",
		"cancelRenderFrameForHandle|function",
		"inspectProgrammaticImageBytes|function",
		"validateImageSequenceImageBytes|function",
		"validateImageSequenceManifestJson|function",
		"sampleParticleSurfaceJson|function",
		"particleTransportPolicyJson|function",
		"applyHyperframesAudioTrackGainPcm|function",
		"mixHyperframesAudioBusPcm|function",
		"mixHyperframesAudioMasterPcm|function",
		"prepareHyperframesAudioDryTrackPcm|function",
		"resolveHyperframesAudioDiscoveryJson|function",
		"resolveHyperframesAudioExecutionPlanJson|function",
		"resolveHyperframesAudioGraphJson|function",
		"resolveHyperframesAudioObservationsJson|function",
		"resolveHyperframesAudioSeekJson|function",
		"resolveHyperframesBusFaderJson|function",
		"normalizeHyperframesFxChainJson|function",
		"resolveProgrammaticAudioSourceJson|function",
		"resolveVideoExportJson|function",
		"resolveNativeAudioDecodeJson|function",
		"mixProgrammaticAudioPcm|function",
		"programmaticAudioPolicyJson|function",
		"resolveRemotionAudioFrameJson|function",
		"resolveHyperframesAudioFrameJson|function",
		"resolveProgrammaticAudioScheduleJson|function",
		"resolveProgrammaticAudioRangeJson|function",
		"resolveStylizedEffectJson|function",
		"stylizedEffectCatalogJson|function",
		"planSceneMutationJson|function",
		"validateClipEditingJson|function",
		"resolveProgrammaticFrameJson|function",
		"validateProgrammaticResourcesJson|function",
		"prepareMvAudioJson|function",
		"mvRecipeCatalogJson|function",
		"validateSceneStateJson|function",
		"planClipExports|function",
		"normalizeOperationFingerprint|function",
		"planFrameGrid|function",
		"isMediaSourceSpanValid|function",
		"planAudioSampleWindow|function",
		"planAudioMixWindow|function",
		"audioClipSampleTimes|function",
		"evaluateClipTransitions|function",
		"colorAdjustmentCatalog|function",
		"normalizeColorAdjustment|function",
		"planVideoFreezeFrame|function",
		"resolveVideoSourceTime|function",
		"MOTION_TEXT_PLAN_VERSION|function",
		"MOTION_TEXT_SCHEMA_VERSION|function",
		"TICKS_PER_SECOND|function",
		"__externref_table_alloc|function",
		"__externref_table_dealloc|function",
		"__wbg_wasmruntimegpuresourcequery_free|function",
		"__wbg_wasmruntimegraphicsquery_free|function",
		"__wbindgen_destroy_closure|function",
		"__wbindgen_exn_store|function",
		"__wbindgen_externrefs|table",
		"__wbindgen_free|function",
		"__wbindgen_malloc|function",
		"__wbindgen_realloc|function",
		"__wbindgen_start|function",
		"analyzeMotionTextAudio|function",
		"applyEffectPasses|function",
		"applyMaskFeather|function",
		"assessMotionTextAudioSync|function",
		"createCompositor|function",
		"createMotionTextPresetPreview|function",
		"createMotionTextSequence|function",
		"createMotionTextVariationCandidate|function",
		"disposeCompositor|function",
		"disposeGpu|function",
		"duplicateMotionTextSequence|function",
		"floorToFrame|function",
		"formatTimecode|function",
		"getCompositorCanvasForHandle|function",
		"getCompositorCanvas|function",
		"getLastFrameProfile|function",
		"guessTimecodeFormat|function",
		"initCompositor|function",
		"initializeGpu|function",
		"inspectMotionTextFont|function",
		"inspectMotionTextFontCoverage|function",
		"importJizuraMotionTextProject|function",
		"isFrameAligned|function",
		"lastFrameTime|function",
		"mediaTimeAdd|function",
		"mediaTimeClamp|function",
		"mediaTimeFromFrame|function",
		"mediaTimeFromSeconds|function",
		"mediaTimeMax|function",
		"mediaTimeMin|function",
		"mediaTimeSub|function",
		"mediaTimeToFrame|function",
		"mediaTimeToSeconds|function",
		"validateMediaTimeRange|function",
		"mapMotionTextClipTime|function",
		"mapMotionTextSequenceTimeToTimeline|function",
		"memory|memory",
		"mutateMotionTextSequence|function",
		"parseMotionTextSource|function",
		"parseTimecode|function",
		"planMotionTextSequence|function",
		"releaseTextureForHandle|function",
		"releaseTexture|function",
		"renderFrameForHandle|function",
		"renderFrame|function",
		"resizeCompositorForHandle|function",
		"resizeCompositor|function",
		"resolveMotionTextAudioClipBinding|function",
		"resolveMotionTextBeatGrid|function",
		"restyleMotionTextSequence|function",
		"roundToFrame|function",
		"snapMotionTextTimeToBeat|function",
		"snappedSeekTime|function",
		"tokenizeMotionText|function",
		"uploadTextureForHandle|function",
		"uploadTexture|function",
		"wasm_bindgen__convert__closures_____invoke__h6e68ca372e8bf468|function",
		"wasm_bindgen__convert__closures_____invoke__h755062247edbbf0a|function",
		"wasm_bindgen__convert__closures_____invoke__hf7fc07325ff431aa|function",
		"wasmruntimegpuresourcequery_liveHandles|function",
		"wasmruntimegpuresourcequery_new|function",
		"wasmruntimegpuresourcequery_release|function",
		"wasmruntimegraphicsquery_concurrentCompositorInstances|function",
		"wasmruntimegraphicsquery_new|function",
		"wasmruntimegraphicsquery_selectedBackend|function",
		"wasmruntimegraphicsquery_unavailableReason|function",
		// Reviewed additions: 95 stable exports and one readback timer trampoline.
		"__wbg_liquidobjecttransportowner_free|function",
		"__wbg_mvheartowner_free|function",
		"__wbg_mvimagepreprocessowner_free|function",
		"__wbg_mvjzowner_free|function",
		"__wbg_mvlutatlasowner_free|function",
		"__wbg_mvmemoriesoutput_free|function",
		"__wbg_mvmemoriesowner_free|function",
		"__wbg_mvmemoriespreparation_free|function",
		"__wbg_mvmemoriesstage_free|function",
		"__wbg_mvnightowner_free|function",
		"encodeRemotionProducedAudioWav|function",
		"evaluateLiquidObjectFrameJson|function",
		"inspectScalarAnimationDomainsJson|function",
		"liquidObjectTransportPolicyJson|function",
		"liquidobjecttransportowner_command|function",
		"liquidobjecttransportowner_new|function",
		"mixRemotionProducedAudioPcm|function",
		"mvheartowner_cancel|function",
		"mvheartowner_capabilityJson|function",
		"mvheartowner_diagnosticJson|function",
		"mvheartowner_dispose|function",
		"mvheartowner_frameJson|function",
		"mvheartowner_imageBytes|function",
		"mvheartowner_manifestJson|function",
		"mvheartowner_new|function",
		"mvheartowner_prepareSky|function",
		"mvheartowner_prepare|function",
		"mvimagepreprocessowner_admit|function",
		"mvimagepreprocessowner_begin|function",
		"mvimagepreprocessowner_dispose|function",
		"mvimagepreprocessowner_key|function",
		"mvimagepreprocessowner_new|function",
		"mvimagepreprocessowner_request|function",
		"mvimagepreprocessowner_step|function",
		"mvimagepreprocessowner_take|function",
		"mvjzowner_checkText|function",
		"mvjzowner_dispose|function",
		"mvjzowner_finishFrame|function",
		"mvjzowner_frame|function",
		"mvjzowner_new|function",
		"mvjzowner_preparedJson|function",
		"mvjzowner_prepare|function",
		"mvjzowner_release|function",
		"mvlutatlasowner_bindRow|function",
		"mvlutatlasowner_clear|function",
		"mvlutatlasowner_dispose|function",
		"mvlutatlasowner_new|function",
		"mvlutatlasowner_prepare|function",
		"mvlutatlasowner_resolveParameters|function",
		"mvlutatlasowner_rowPixels|function",
		"mvlutatlasowner_sample|function",
		"mvmemoriesoutput_bytes|function",
		"mvmemoriesoutput_json|function",
		"mvmemoriesowner_acceptStage|function",
		"mvmemoriesowner_beginStage|function",
		"mvmemoriesowner_cancelStage|function",
		"mvmemoriesowner_cancel|function",
		"mvmemoriesowner_capabilityJson|function",
		"mvmemoriesowner_diagnosticJson|function",
		"mvmemoriesowner_dispose|function",
		"mvmemoriesowner_finishFrame|function",
		"mvmemoriesowner_frame|function",
		"mvmemoriesowner_measurementRequestsJson|function",
		"mvmemoriesowner_new|function",
		"mvmemoriesowner_prepareReserved|function",
		"mvmemoriesowner_preparedBytes|function",
		"mvmemoriesowner_preparedJson|function",
		"mvmemoriesowner_prepare|function",
		"mvmemoriesowner_reserve|function",
		"mvmemoriesowner_sourceAdmissionJson|function",
		"mvmemoriesowner_sourceRequestsJson|function",
		"mvmemoriesstage_bytes|function",
		"mvmemoriesstage_json|function",
		"mvnightowner_bindDecoded|function",
		"mvnightowner_bindLutRow|function",
		"mvnightowner_bindReflection|function",
		"mvnightowner_clear|function",
		"mvnightowner_diagnostic|function",
		"mvnightowner_dispose|function",
		"mvnightowner_evaluate|function",
		"mvnightowner_new|function",
		"mvnightowner_preflight|function",
		"mvnightowner_prepareLut|function",
		"mvnightowner_prepare|function",
		"mvnightowner_releaseFrame|function",
		"prepareRemotionInlineAudioSourcesJson|function",
		"resolveEffectLayerParamsJson|function",
		"resolveGlassObjectParamsJson|function",
		"resolveInkObjectParamsJson|function",
		"resolveLiquidObjectParamsJson|function",
		"resolveProgrammaticFrameTunnelJson|function",
		"resolveRemotionProducedAssetsJson|function",
		"resolveRemotionProducedFramesJson|function",
		"sampleScalarAnimationBatchJson|function",
		"validateMasterEffectsJson|function",
		"wasm_bindgen__convert__closures_____invoke__hda92ba54d0ef34af|function",
	],
	wasmImportSignature:
		"09f3664f1935db3c374d8aa7c312cd913343cd614d9853e5bd5bea0e9ff597fa",
	wasmImportCount: 631,
	/**
	 * The `exports` conditions `emitSyncEntry` writes. Recorded here so the routing that makes the
	 * artifact initializable outside a bundler is a contract term rather than an incidental
	 * property of a build script — `check-wasm-init.mjs` proves it *runs*, this proves it is
	 * *declared*, and neither alone would catch a silent condition swap.
	 *
	 * **`node` is deliberately absent.** Bundlers targeting node set that condition too, and they
	 * do not resolve the entry's `new URL("./x.wasm", import.meta.url)` to a readable file:
	 * measured on this repo's Next Host, turbopack rewrote it to
	 * `/_next/static/media/opencut_wasm_bg.<hash>.wasm` and the SSR build failed. Node consumers
	 * take `SYNC_SUBPATH` explicitly.
	 */
	entryConditions: {
		types: "./opencut_wasm.d.ts",
		bun: `./${SYNC_ENTRY}`,
		default: `./${BUNDLER_ENTRY}`,
	},
	/** The declared opt-in subpath for runtimes that need explicit instantiation. */
	syncSubpath: "./sync",
};

export const CONTROLS = {
	"missing-export": "wrapper-exports",
	"extra-export": "wrapper-exports",
	"changed-binary-import": "wasm-imports",
	"changed-binary-export": "wasm-exports",
	"extra-trampoline": "wasm-exports",
	"missing-trampoline": "wasm-exports",
	"stable-export-disguised-as-trampoline": "wasm-exports",
	"edited-declaration": "binary-declarations",
	"edited-license": "generated-files",
	"invalid-backend": "graphics-provider",
	"boolean-count": "graphics-provider",
	"boolean-handles": "gpu-provider",
	"provider-any": "gpu-provider",
	"unkeyed-release": "gpu-provider",
	"truncated-files": "generated-files",
	"sync-entry-export-drift": "entry-parity",
	"sync-entry-uninitialized": "entry-parity",
	"condition-swap": "entry-conditions",
	"condition-dropped": "entry-conditions",
	"sync-subpath-dropped": "entry-conditions",
	"sync-subpath-types-dropped": "entry-conditions",
	"node-condition-added": "entry-conditions",
	"check-wasm-missing-registration": "gate-registration",
	"check-wasm-decoy-registration": "gate-registration",
	"ci-missing-registration": "gate-registration",
	"ci-before-install-registration": "gate-registration",
	"gated-missing-registration": "gate-registration",
};

/**
 * POSITIVE controls: mutations the contract must TOLERATE. A re-scope is only honest if the
 * thing it now permits is asserted to be permitted — otherwise the next reader cannot tell a
 * deliberate tolerance from a hole nobody noticed.
 */
export const POSITIVE_CONTROLS = {
	"crlf-checkout":
		"an autocrlf=true checkout, so the copied LICENSE/README arrive with CRLF (the exact windows-latest observation)",
	"trampoline-hash-swap":
		"another build host's closure-trampoline symbol hashes (the exact CI observation)",
};
