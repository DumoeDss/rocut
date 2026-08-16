/**
 * The recorded wasm surface.
 *
 * **How to re-derive every value here**, so a reader can check rather than trust:
 *
 *     node script/build-wasm.mjs                 # on the pinned toolchain (rust-toolchain.toml
 *                                                # + WASM_PACK_VERSION); build-wasm refuses otherwise
 *     sha256sum rust/wasm/pkg/*                  # pinnedHashes, and the dts/wrapper/wasmDts values
 *     node script/check-wasm-api-surface.mjs     # reports every value that has moved, by id
 *
 * **Why the pins matter to this file.** Three of the 58 wasm exports are rustc symbol-hash names
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
 * Exactly 3 in, 3 out, total unchanged at 58, and **all 55 other exports identical**. The gate
 * printed that difference itself; the re-scope was written only after seeing it, not from the
 * hypothesis that preceded it.
 *
 * `UPSTREAM.md` § WASM rebuild correspondence had already established the same rule for the
 * published-vs-self-built comparison — "stripping the hash makes the two sets identical, and they
 * correspond 1:1" — so this applies the repository's own existing finding to its gate.
 *
 * **What is still asserted, so this is a re-scope and not a hole**: the count of trampolines is
 * exactly `trampolineExportCount`, each must match this shape, the other 55 are an exact set, and
 * the total is still 58. A 4th trampoline, a missing one, a renamed stable export, or a stable
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
			"f92d109c0ed431a74974f90bf207767c033f784af10a34a0accebb1bb921ca18",
		[SYNC_ENTRY]:
			"aa6081035bd18e34e99c22e4fa7f3e41d212a602fd6ab552d654f948c4ae6471",
	},
	/**
	 * `LICENSE` and `README.md` are the only two files wasm-pack **copies out of the checkout**
	 * rather than generates, so their bytes carry the *checkout's* line-ending configuration, not a
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
	dtsSha: "e7d942d396f17ebca7fed8ccfe3f9e671103ad733c5ce183ef00d3519720596a",
	wrapperSha:
		"19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1",
	/**
	 * The low-level declarations, hashed after normalising the trampoline hashes below and sorted
	 * by line. Exact-byte hashing of this file cannot hold across build hosts for the reason
	 * documented at `TRAMPOLINE_EXPORT`; every other line is still compared verbatim, and the line
	 * count is pinned, so an added, removed or edited declaration is still caught.
	 *
	 * Recorded on Windows; the value is host-independent by construction. Re-derive with
	 * `rasen/changes/wasm-determinism-init/evidence/rescope-values.mjs`.
	 */
	wasmDtsNormalizedSignature:
		"b03cb7f5c8f12350c38545f8b49fbc3957c5d21813a92e5004560f63f47ad402",
	wasmDtsLineCount: 60,
	wrapperExportSignature:
		"a9a91d9ad6a8b1a13185e8892a2820752c9be4a2885a18edc71c24ee53769cc9",
	bgExportSignature:
		"5cb5e6fff95cfcfd2fb70dab7a89628eb087ae9797ada39db9fcf336b649364f",
	/**
	 * The 55 stably-named binary exports, as an exact set. This is the real contract: every export
	 * a consumer can name is pinned here, and any addition, removal or rename fails.
	 *
	 * The remaining 3 are compiler-generated closure trampolines whose names carry a rustc symbol
	 * hash — see `TRAMPOLINE_EXPORT` for why they are matched by shape and count instead.
	 */
	stableWasmExportSignature:
		"aac46c356951410ed81141f3e564d95e9212fec6987381429049d2e0b3809547",
	stableWasmExportCount: 55,
	trampolineExportCount: 3,
	/**
	 * The whole 58-entry set as recorded on the Windows build machine, kept for diagnosis: on
	 * failure the gate prints the symmetric difference against it, which is how the host-varying
	 * trampolines were identified in the first place (CI run 31940776057). It is NOT the
	 * assertion — `stableWasmExportSignature` is.
	 */
	wasmExportsAsRecorded: [

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
		"applyEffectPasses|function",
		"applyMaskFeather|function",
		"createCompositor|function",
		"disposeCompositor|function",
		"disposeGpu|function",
		"floorToFrame|function",
		"formatTimecode|function",
		"getCompositorCanvasForHandle|function",
		"getCompositorCanvas|function",
		"getLastFrameProfile|function",
		"guessTimecodeFormat|function",
		"initCompositor|function",
		"initializeGpu|function",
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
		"memory|memory",
		"parseTimecode|function",
		"releaseTextureForHandle|function",
		"releaseTexture|function",
		"renderFrameForHandle|function",
		"renderFrame|function",
		"resizeCompositorForHandle|function",
		"resizeCompositor|function",
		"roundToFrame|function",
		"snappedSeekTime|function",
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
	],
	wasmImportSignature:
		"2da5921beca72832c11efe8a93e3228649ab22ec41d78313f0f4c74fcdd44001",
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
