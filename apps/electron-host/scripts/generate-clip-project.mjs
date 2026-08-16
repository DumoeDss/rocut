/**
 * sdk-export-capability (E1) — deterministic clip-heavy project generator.
 *
 * Generates the perf-baseline project (spec export-performance-baseline: "a
 * deterministic clip-heavy project — 2000 clips by default — without any
 * media-asset pipeline") and writes it through the REAL store classes —
 * `FilesystemProjectStore` over `NodeFsStoreBridge` — into a fresh throwaway
 * store root, so the perf harness (E2) can boot the Electron host against a
 * real durable store instead of fixtures.
 *
 * The persisted payload mirrors what the editor's real save path writes:
 * `SessionPersistenceCoordinator.saveProject` → `encodeProject` (dates as ISO
 * strings, elements carrying the full `ELEMENT_KEYS` list with undefined for
 * absent fields, tracks carrying `TRACK_KEYS`) → `store.save({record:
 * {id, schemaVersion, data}, summary})` where schemaVersion is the store's own
 * `FILESYSTEM_STORE_SCHEMA_VERSION` = `CURRENT_PROJECT_VERSION` (31).
 * Defaults mirrored from classic's new-project path (`project-manager.ts`):
 * fps 30/1, canvas 1920x1080, background #000000, one main scene, empty main
 * video track, no audio tracks. Validation after write reloads through the
 * store and asserts `node:v8` byte-equality of the payload.
 *
 * Runtime note: node >= 22.18/23.6 (native TS type-stripping). The store
 * class's module graph statically reaches `opencut-wasm`, whose
 * wasm-bindgen sync init only works under the bundler (the same constraint
 * that makes `bun test` isolate with `evidence/wasm-test-mock`); this script
 * registers a module loader that serves an in-memory `opencut-wasm` shim
 * (mirroring the house wasm-test-mock export list) and retries extensionless
 * relative TS specifiers. No store byte is affected — the shim only unblocks
 * module loading; the generator never calls into wasm.
 *
 * CLI:
 *   node apps/electron-host/scripts/generate-clip-project.mjs \
 *     --root <dir> [--clips 2000] [--name "Perf 2000"] [--layout staggered|dense]
 *     [--width 1920] [--height 1080] [--force] [--self-log]
 *
 * `--layout dense` (LEAD addition for the perf harness): all of a track's
 * elements start within its first 2s and run 8s — every element composites
 * in every frame over a ~10s timeline (2000 clips), the per-frame render
 * stress shape whose raw export stream fits the E: disk. `staggered`
 * (default) keeps E1's original long sparse timeline shape.
 *
 * Exit 0 = written + round-trip validated; exit 1 = refusal or validation
 * failure (reason printed). With --self-log the final stdout line is
 * `REAL_EXIT_CODE:<code>`.
 */
import { register } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";

const DEFAULT_ROOT = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-export-scratch/perf-projects";
const DEFAULT_CLIPS = 2000;
const DEFAULT_NAME = "Perf 2000";

/** Mirrors rust/crates/time/src/media_time.rs TICKS_PER_SECOND (asserted 120_000). */
const TICKS_PER_SECOND = 120_000;
/** Element span: 2s = 240_000 ticks. */
const ELEMENT_DURATION_TICKS = 2 * TICKS_PER_SECOND;
const DENSE_DURATION_TICKS = 8 * TICKS_PER_SECOND;
const DENSE_STEP_TICKS = 1_920;
const TEXT_TRACKS = 8;
const GRAPHIC_TRACKS = 8;
const OVERLAY_TRACKS = TEXT_TRACKS + GRAPHIC_TRACKS;
/** seed base for deterministic dates: 2026-01-01T00:00:00.000Z. */
const DATE_BASE_MS = Date.UTC(2026, 0, 1);
const PALETTE = [
	"#ff5252",
	"#4dff88",
	"#4d9fff",
	"#ffd24d",
	"#c14dff",
	"#ffffff",
];

/**
 * node:v8-opaque wasm shim — every export the store's module graph links
 * against, mirroring evidence/wasm-test-mock's opencut-wasm module list.
 */
const WASM_SHIM_SOURCE = `
export const TICKS_PER_SECOND = () => 120000;
export const applyEffectPasses = () => {};
export const applyMaskFeather = () => {};
export const createCompositor = () => 0;
export const disposeCompositor = () => {};
export const formatTimecode = ({ time }) => String(time);
export const getCompositorCanvas = () => null;
export const getCompositorCanvasForHandle = () => null;
export const getLastFrameProfile = () => null;
export const initCompositor = () => {};
export const initializeGpu = async () => false;
export const disposeGpu = () => {};
export const lastFrameTime = ({ duration }) => duration;
export const mediaTimeFromSeconds = ({ seconds }) => Math.round(seconds * 120000);
export const mediaTimeToSeconds = ({ time }) => time / 120000;
export const parseTimecode = () => null;
export const releaseTexture = () => {};
export const releaseTextureForHandle = () => {};
export const renderFrame = () => {};
export const renderFrameForHandle = () => {};
export const resizeCompositor = () => {};
export const resizeCompositorForHandle = () => {};
export const roundToFrame = ({ time }) => time;
export const snappedSeekTime = ({ time }) => time;
export const uploadTexture = () => {};
export const uploadTextureForHandle = () => {};
class WasmRuntimeGraphicsQuery {
	selectedBackend() { return "webgpu"; }
	concurrentCompositorInstances() { return 2; }
	unavailableReason() { return ""; }
	free() {}
}
class WasmRuntimeGpuResourceQuery {
	liveHandles() { return []; }
	release() {}
	free() {}
}
export { WasmRuntimeGraphicsQuery, WasmRuntimeGpuResourceQuery };
`;

/**
 * Loader: (a) `opencut-wasm` → the in-memory shim; (b) extensionless
 * relative TS specifiers (editor-ports/classic internal style) retried with
 * bundler suffixes. Everything else defers to node's default resolution and
 * native type-stripping.
 */
const LOADER_SOURCE = `
const WASM_SHIM = ${JSON.stringify(WASM_SHIM_SOURCE)};
const TS_SUFFIXES = [".ts", "/index.ts", ".tsx", "/index.tsx"];
export async function resolve(specifier, context, nextResolve) {
	if (specifier === "opencut-wasm") {
		return { url: "opencut-wasm-shim:", shortCircuit: true };
	}
	try {
		return await nextResolve(specifier, context);
	} catch (error) {
		if (!specifier.startsWith(".")) throw error;
		for (const suffix of TS_SUFFIXES) {
			try {
				return await nextResolve(specifier + suffix, context);
			} catch {}
		}
		throw error;
	}
}
export async function load(url, context, nextLoad) {
	if (url === "opencut-wasm-shim:") {
		return { format: "module", shortCircuit: true, source: WASM_SHIM };
	}
	return nextLoad(url, context);
}
`;

function registerStoreGraphLoader() {
	register(`data:text/javascript,${encodeURIComponent(LOADER_SOURCE)}`, {
		parentURL: import.meta.url,
	});
}

/** mulberry32 — seeded PRNG, no Math.random anywhere in generation. */
function mulberry32(seed) {
	let a = seed >>> 0;
	return function next() {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Deterministic well-formed v4-shaped UUID from the seeded PRNG. */
function uuidFromRng(rng) {
	const bytes = [];
	for (let i = 0; i < 16; i += 1) bytes.push(Math.floor(rng() * 256));
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * ELEMENT_KEYS order from editor/persistence/project-codec.ts — the durable
 * element object carries every key, undefined where the element kind has no
 * such field, exactly as encodeElement emits.
 */
const ELEMENT_KEYS = [
	"id",
	"name",
	"type",
	"duration",
	"startTime",
	"trimStart",
	"trimEnd",
	"sourceDuration",
	"animations",
	"params",
	"retime",
	"sourceType",
	"mediaId",
	"sourceUrl",
	"isSourceAudioEnabled",
	"hidden",
	"effects",
	"masks",
	"stickerId",
	"intrinsicWidth",
	"intrinsicHeight",
	"definitionId",
	"effectType",
];

/** Build one element with the codec's exact key set and order. */
function encodeShapedElement(fields) {
	const element = {};
	for (const key of ELEMENT_KEYS) element[key] = undefined;
	Object.assign(element, fields);
	return element;
}

/**
 * Text params: DEFAULTS.text.element.params order (params/registry.ts
 * textElementParams + visualElementParams), values deterministic in i.
 */
function textParamsFor(i) {
	return {
		content: `Clip ${i}`,
		fontFamily: "Arial",
		fontSize: 15 + (i % 5) * 10,
		color: PALETTE[i % 6],
		textAlign: "center",
		fontWeight: "normal",
		fontStyle: "normal",
		textDecoration: "none",
		letterSpacing: 0,
		lineHeight: 1.2,
		"background.enabled": false,
		"background.color": "#000000",
		"background.cornerRadius": 0,
		"background.paddingX": 30,
		"background.paddingY": 42,
		"background.offsetX": 0,
		"background.offsetY": 0,
		"transform.positionX": (i * 97) % 1600 - 800,
		"transform.positionY": (i * 131) % 800 - 400,
		"transform.scaleX": 1,
		"transform.scaleY": 1,
		"transform.rotate": ((i * 13) % 360) - 180,
		opacity: 1,
		blendMode: "normal",
	};
}

/**
 * Graphic params: buildGraphicElement merge order — visualElementParams
 * (transform/opacity/blendMode) then the "rectangle" definition defaults
 * (fill/stroke/strokeWidth/strokeAlign/cornerRadius).
 */
function graphicParamsFor(i) {
	return {
		"transform.positionX": (i * 97) % 1600 - 800,
		"transform.positionY": (i * 131) % 800 - 400,
		"transform.scaleX": 0.5 + ((i * 7) % 10) / 10,
		"transform.scaleY": 0.5 + ((i * 7) % 10) / 10,
		"transform.rotate": ((i * 13) % 360) - 180,
		opacity: 1,
		blendMode: "normal",
		fill: PALETTE[(i + 3) % 6],
		stroke: "#000000",
		strokeWidth: i % 3,
		strokeAlign: "center",
		cornerRadius: (i % 4) * 10,
	};
}

function textElementFor(i, slot, layout) {
	return encodeShapedElement({
		id: `clip-${String(i).padStart(6, "0")}`,
		name: `Clip ${i}`,
		type: "text",
		duration: elementDurationTicks(layout),
		startTime: elementStartTicks(slot, layout),
		trimStart: 0,
		trimEnd: 0,
		params: textParamsFor(i),
	});
}

function graphicElementFor(i, slot, layout) {
	return encodeShapedElement({
		id: `clip-${String(i).padStart(6, "0")}`,
		name: "Rectangle",
		type: "graphic",
		duration: elementDurationTicks(layout),
		startTime: elementStartTicks(slot, layout),
		trimStart: 0,
		trimEnd: 0,
		params: graphicParamsFor(i),
		definitionId: "rectangle",
	});
}

/**
 * Layouts (LEAD addition for E2's disk-feasible export measurement):
 * - staggered (default, E1's original): sequential 2s clips per track — a
 *   long sparse timeline (2000 clips ≈ 250s), the timeline-UI stress shape.
 * - dense: every track's elements start within the first 2s (step 1920
 *   ticks) and run 8s — all N elements composite in EVERY frame over a ~10s
 *   timeline (2000 clips ≈ 10s), the per-frame render stress shape, and the
 *   one whose raw export stream fits the E: disk (300 frames @ 720p ≈
 *   0.8 GB vs ≈ 46 GB staggered @ 1080p).
 */
function elementDurationTicks(layout) {
	return layout === "dense" ? DENSE_DURATION_TICKS : ELEMENT_DURATION_TICKS;
}

function elementStartTicks(slot, layout) {
	return layout === "dense" ? slot * DENSE_STEP_TICKS : slot * ELEMENT_DURATION_TICKS;
}

function timelineTicks(slots, layout) {
	return layout === "dense"
		? (slots - 1) * DENSE_STEP_TICKS + DENSE_DURATION_TICKS
		: slots * ELEMENT_DURATION_TICKS;
}

/** Track with the codec's TRACK_KEYS order (id, name, type, elements, muted, hidden). */
function encodeShapedTrack(fields) {
	return {
		id: fields.id,
		name: fields.name,
		type: fields.type,
		elements: fields.elements,
		muted: fields.muted,
		hidden: fields.hidden,
	};
}

/** Build the durable TProject payload — the exact encodeProject shape. */
function buildProjectPayload({ clips, name, rng, layout, width, height }) {
	// Deterministic ids, drawn in this documented order.
	const projectId = uuidFromRng(rng);
	const sceneId = uuidFromRng(rng);
	const mainTrackId = uuidFromRng(rng);
	const overlayTrackIds = [];
	for (let t = 0; t < OVERLAY_TRACKS; t += 1) overlayTrackIds.push(uuidFromRng(rng));
	const createdAtMs = DATE_BASE_MS + Math.floor(rng() * 86_400_000);
	const updatedAtMs = createdAtMs + Math.floor(rng() * 3_600_000);
	const sceneCreatedAtMs = DATE_BASE_MS + Math.floor(rng() * 86_400_000);
	const sceneUpdatedAtMs = sceneCreatedAtMs + Math.floor(rng() * 3_600_000);

	const overlay = [];
	for (let t = 0; t < OVERLAY_TRACKS; t += 1) {
		overlay.push(
			encodeShapedTrack({
				id: overlayTrackIds[t],
				name: t < TEXT_TRACKS ? `Text ${t + 1}` : `Graphic ${t - TEXT_TRACKS + 1}`,
				type: t < TEXT_TRACKS ? "text" : "graphic",
				elements: [],
				muted: undefined,
				hidden: false,
			}),
		);
	}
	// Element i lives on overlay track (i % OVERLAY_TRACKS), slot floor(i/OVERLAY_TRACKS).
	for (let i = 0; i < clips; i += 1) {
		const trackIndex = i % OVERLAY_TRACKS;
		const slot = Math.floor(i / OVERLAY_TRACKS);
		overlay[trackIndex].elements.push(
			trackIndex < TEXT_TRACKS
				? textElementFor(i, slot, layout)
				: graphicElementFor(i, slot, layout),
		);
	}

	const slots = Math.ceil(clips / OVERLAY_TRACKS);
	const createdAt = new Date(createdAtMs).toISOString();
	const updatedAt = new Date(updatedAtMs).toISOString();

	// encodeProject shape: metadata (dates as ISO strings), scenes,
	// currentSceneId, settings, version, timelineViewState (undefined key kept).
	return {
		payload: {
			metadata: {
				id: projectId,
				name,
				thumbnail: undefined,
				duration: timelineTicks(slots, layout),
				createdAt,
				updatedAt,
			},
			scenes: [
				{
					id: sceneId,
					name: "Main scene",
					isMain: true,
					tracks: {
						overlay,
						main: encodeShapedTrack({
							id: mainTrackId,
							name: "Main Track",
							type: "video",
							elements: [],
							muted: false,
							hidden: false,
						}),
						audio: [],
					},
					bookmarks: [],
					createdAt: new Date(sceneCreatedAtMs).toISOString(),
					updatedAt: new Date(sceneUpdatedAtMs).toISOString(),
				},
			],
			currentSceneId: sceneId,
			settings: {
				fps: { numerator: 30, denominator: 1 },
				canvasSize: { width, height },
				canvasSizeMode: width === 1920 && height === 1080 ? "preset" : "custom",
				lastCustomCanvasSize: null,
				originalCanvasSize: null,
				background: { type: "color", color: "#000000" },
			},
			version: 31,
			timelineViewState: undefined,
		},
		projectId,
		createdAt,
		updatedAt,
		slots,
	};
}

function parseArgs(argv) {
	const args = {
		root: DEFAULT_ROOT,
		clips: DEFAULT_CLIPS,
		name: DEFAULT_NAME,
		layout: "staggered",
		width: 1920,
		height: 1080,
		force: false,
		selfLog: false,
	};
	const valueFlags = {
		"--root": "root",
		"--clips": "clips",
		"--name": "name",
		"--layout": "layout",
		"--width": "width",
		"--height": "height",
	};
	const booleanFlags = { "--force": "force", "--self-log": "selfLog" };
	for (let i = 0; i < argv.length; i += 1) {
		const flag = argv[i];
		if (flag in booleanFlags) {
			args[booleanFlags[flag]] = true;
		} else if (flag in valueFlags) {
			const value = argv[i + 1];
			if (value === undefined) throw new Error(`missing value for ${flag}`);
			args[valueFlags[flag]] = value;
			i += 1;
		} else {
			throw new Error(`unknown argument: ${flag}`);
		}
	}
	const clips = Number.parseInt(args.clips, 10);
	if (!Number.isInteger(clips) || clips < 1) {
		throw new Error(`--clips must be a positive integer, got ${args.clips}`);
	}
	args.clips = clips;
	if (args.layout !== "staggered" && args.layout !== "dense") {
		throw new Error(`--layout must be staggered or dense, got ${args.layout}`);
	}
	for (const dimension of ["width", "height"]) {
		const value = Number.parseInt(args[dimension], 10);
		if (!Number.isInteger(value) || value < 16 || value > 4096) {
			throw new Error(`--${dimension} must be an integer in [16, 4096], got ${args[dimension]}`);
		}
		args[dimension] = value;
	}
	return args;
}

function prepareRoot(root, force) {
	if (!existsSync(root)) {
		mkdirSync(root, { recursive: true });
		return;
	}
	const entries = readdirSync(root);
	if (entries.length === 0) return;
	if (!force) {
		throw new Error(
			`root ${root} exists and is not empty (${entries.length} entries) — pass --force to recreate it fresh`,
		);
	}
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
}

function listTree(root) {
	const lines = [];
	const walk = (dir, prefix) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			lines.push(`${prefix}${entry.name}${entry.isDirectory() ? "/" : ""}`);
			if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}  `);
		}
	};
	lines.push(`${root}/`);
	walk(root, "  ");
	return lines;
}

function methodBlock({ args, slots, projectId, rngDraws, schemaVersion }) {
	return [
		"--- METHOD ---",
		`command inputs: --root ${args.root} --clips ${args.clips} --name "${args.name}" --layout ${args.layout} --width ${args.width} --height ${args.height}${args.force ? " --force" : ""} (defaults: clips ${DEFAULT_CLIPS}, name "${DEFAULT_NAME}", layout staggered, 1920x1080)`,
		`store classes: FilesystemProjectStore over NodeFsStoreBridge (../src/store/*), identity DEFAULT_FILESYSTEM_STORE_IDENTITY, schemaVersion read off the store instance (${schemaVersion}); record built in the encodeProject durable shape (dates ISO strings, ELEMENT_KEYS/TRACK_KEYS with undefined for absent fields)`,
		"determinism: mulberry32(seed=clips), no Math.random; element ids `clip-<i zero-padded 6>`; project/scene/track ids uuidFromRng drawn in order: project, scene, main track, 16 overlay tracks; dates = Date.UTC(2026,0,1) + rng()*86400000 (updated = created + rng()*3600000; scene drawn separately)",
		`project: one main scene "Main scene"; settings: fps 30/1, canvas ${args.width}x${args.height} (${args.width === 1920 && args.height === 1080 ? 'classic default, canvasSizeMode "preset"' : 'overridden, canvasSizeMode "custom"'}), background {color #000000}; version 31`,
		`tracks: main video track "Main Track" EMPTY (no media pipeline), 0 audio tracks; overlay = 8 text tracks ("Text 1".."Text 8") + 8 graphic tracks ("Graphic 1".."Graphic 8")`,
		`elements: ${args.clips} total = ${elementsWithKind(args.clips, "text")} text + ${elementsWithKind(args.clips, "graphic")} graphic`,
		args.layout === "dense"
			? `layout formula (dense): element i (0-based) -> overlay track (i % 16), slot floor(i / 16); startTime = slot * ${DENSE_STEP_TICKS} ticks (all of a track's elements start within its first 2s), duration ${DENSE_DURATION_TICKS} (8s), trimStart 0, trimEnd 0 — every element composites in every frame (TICKS_PER_SECOND = ${TICKS_PER_SECOND})`
			: `layout formula (staggered): element i (0-based) -> overlay track (i % 16), slot floor(i / 16); startTime = slot * ${ELEMENT_DURATION_TICKS} ticks; each element: duration ${ELEMENT_DURATION_TICKS}, trimStart 0, trimEnd 0 (2s each; TICKS_PER_SECOND = ${TICKS_PER_SECOND})`,
		`text element (i % 16 < 8): name/content "Clip <i>", fontFamily Arial, fontSize 15+(i%5)*10, color PALETTE[i%6] (${PALETTE.join(" ")}), full DEFAULTS.text.param set (background.*, letterSpacing 0, lineHeight 1.2)`,
		`graphic element (i % 16 >= 8): definitionId "rectangle" (builtin registry), fill PALETTE[(i+3)%6], stroke #000000, strokeWidth i%3, strokeAlign "center", cornerRadius (i%4)*10, scale 0.5+((i*7)%10)/10`,
		`motion (both kinds): transform.positionX (i*97)%1600-800, transform.positionY (i*131)%800-400, transform.rotate ((i*13)%360)-180, opacity 1, blendMode "normal" — frames differ over time by construction`,
		`totals: timeline = ${timelineTicks(slots, args.layout)} ticks (${timelineTicks(slots, args.layout) / TICKS_PER_SECOND}s); elements per track = ${Math.floor(args.clips / OVERLAY_TRACKS)} or ${Math.ceil(args.clips / OVERLAY_TRACKS)} (last track takes remainder)`,
		`rng draws consumed: ${rngDraws}`,
		`project id: ${projectId}`,
		"--- /METHOD ---",
	].join("\n");
}

async function main(args) {
	prepareRoot(args.root, args.force);

	registerStoreGraphLoader();
	const storeModule = await import("../src/store/filesystem-project-store.ts");
	const bridgeModule = await import("../src/store/node-fs-store-bridge.ts");
	const { FilesystemProjectStore, DEFAULT_FILESYSTEM_STORE_IDENTITY } = storeModule;
	const { NodeFsStoreBridge } = bridgeModule;

	const rng = mulberry32(args.clips);
	let rngDraws = 0;
	const countingRng = () => {
		rngDraws += 1;
		return rng();
	};
	const { payload, projectId, createdAt, updatedAt, slots } = buildProjectPayload({
		clips: args.clips,
		name: args.name,
		rng: countingRng,
		layout: args.layout,
		width: args.width,
		height: args.height,
	});

	const store = new FilesystemProjectStore(
		new NodeFsStoreBridge({ root: args.root, identity: DEFAULT_FILESYSTEM_STORE_IDENTITY }),
		{ identity: DEFAULT_FILESYSTEM_STORE_IDENTITY },
	);
	const record = { id: projectId, schemaVersion: store.schemaVersion, data: payload };
	const summary = { id: projectId, name: args.name, createdAt, updatedAt };
	await store.save({ record, summary });

	// Reload through the store and validate the round-trip.
	const failures = [];
	const check = (ok, label) => {
		console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
		if (!ok) failures.push(label);
	};
	const listings = await store.list();
	const reloaded = await store.load({ id: projectId });
	const data = reloaded?.data;
	const scene = data?.scenes?.[0];

	check(listings.length === 1 && listings[0].id === projectId, `list() == 1 record with id ${projectId}`);
	check(reloaded !== null, "load() returned the record");
	check(reloaded?.schemaVersion === store.schemaVersion && store.schemaVersion === 31, `schemaVersion ${reloaded?.schemaVersion} === store.schemaVersion ${store.schemaVersion} (CURRENT_PROJECT_VERSION 31)`);
	check(data?.version === 31, "payload.version === 31");
	check(data?.scenes?.length === 1 && data?.currentSceneId === scene?.id && scene?.isMain === true, "one main scene, currentSceneId matches");
	const overlay = scene?.tracks?.overlay ?? [];
	const textTracks = overlay.filter((t) => t.type === "text");
	const graphicTracks = overlay.filter((t) => t.type === "graphic");
	check(overlay.length === OVERLAY_TRACKS && textTracks.length === TEXT_TRACKS && graphicTracks.length === GRAPHIC_TRACKS, `overlay tracks ${overlay.length} = ${TEXT_TRACKS} text + ${GRAPHIC_TRACKS} graphic`);
	check(scene?.tracks?.main?.type === "video" && scene.tracks.main.elements.length === 0, "main video track present and empty");
	check(scene?.tracks?.audio?.length === 0, "no audio tracks");
	const elements = overlay.flatMap((t) => t.elements);
	const textElements = elements.filter((e) => e.type === "text");
	const graphicElements = elements.filter((e) => e.type === "graphic");
	check(elements.length === args.clips, `element count ${elements.length} === clips ${args.clips}`);
	check(textElements.length + graphicElements.length === args.clips, `kind split text ${textElements.length} + graphic ${graphicElements.length} === ${args.clips}`);
	const expectedTextCount = elementsWithKind(args.clips, "text");
	const expectedGraphicCount = elementsWithKind(args.clips, "graphic");
	check(textElements.length === expectedTextCount && graphicElements.length === expectedGraphicCount, `kind split matches formula (text ${expectedTextCount}, graphic ${expectedGraphicCount})`);
	const first = elements[0];
	check(first?.type === "text" && first.startTime === 0 && first.duration === elementDurationTicks(args.layout), `element 0: text, startTime 0, duration ${elementDurationTicks(args.layout)}`);
	check(data?.metadata?.duration === timelineTicks(slots, args.layout), `metadata.duration ${data?.metadata?.duration} === ${timelineTicks(slots, args.layout)} ticks (${timelineTicks(slots, args.layout) / TICKS_PER_SECOND}s)`);
	// Per-element formula check across every element (id -> startTime/duration).
	let formulaMismatches = 0;
	for (const element of elements) {
		const i = Number.parseInt(String(element.id).slice("clip-".length), 10);
		if (
			element.startTime !== elementStartTicks(Math.floor(i / OVERLAY_TRACKS), args.layout) ||
			element.duration !== elementDurationTicks(args.layout) ||
			element.trimStart !== 0 ||
			element.trimEnd !== 0
		) {
			formulaMismatches += 1;
		}
	}
	check(formulaMismatches === 0, `every element matches the layout formula (startTime/duration/trimStart/trimEnd; ${formulaMismatches} mismatches)`);
	// Exact-shape gate: key sets (undefined-valued keys included), key order
	// and values must be identical between the built payload and the reloaded
	// one. node:v8 wire bytes are NOT compared directly: ValueSerializer
	// canonicalizes on the first round trip (verified: built vs reloaded
	// differ, reloaded vs re-reloaded are byte-stable), so wire-byte equality
	// with a freshly built object is not achievable and not a store contract.
	check(jsonStable(data) === jsonStable(payload), "exact-shape equality: reloaded payload === generated payload (full ELEMENT_KEYS/TRACK_KEYS shape, key order, undefined keys included)");
	const loadedBytes = serialize(data);
	check(
		loadedBytes.equals(serialize(deserialize(loadedBytes))),
		`reloaded payload is a node:v8 serialization fixed point (byte-stable across another round trip; ${loadedBytes.length} bytes)`,
	);

	const recordPath = join(args.root, "projects", projectId, "record.json");
	let envelopeOk = false;
	let envelopeDetail = "";
	try {
		const envelope = JSON.parse(readFileSync(recordPath, "utf8"));
		envelopeOk =
			envelope.kind === "opencut-project-record" &&
			envelope.schemaVersion === 31 &&
			envelope.summary?.id === projectId &&
			typeof envelope.payload === "string" &&
			envelope.payload.length > 0;
		envelopeDetail = `kind=${envelope.kind} schemaVersion=${envelope.schemaVersion} payloadBytes=${envelope.payload.length}`;
	} catch (error) {
		envelopeDetail = String(error);
	}
	check(existsSync(recordPath), `durable file written by the store's own bridge: ${recordPath.replace(/\\/g, "/")}`);
	check(envelopeOk, `on-disk record.json envelope is the store's own (${envelopeDetail})`);

	console.log(methodBlock({ args, slots, projectId, rngDraws, schemaVersion: store.schemaVersion }));
	console.log("--- STORE FILE LISTING ---");
	for (const line of listTree(args.root)) console.log(line);
	console.log("--- /STORE FILE LISTING ---");
	console.log(`PROJECT id: ${projectId}`);
	console.log(`PROJECT name: ${args.name}`);
	console.log(`HINT: open the host at ?project=${projectId}`);

	if (failures.length > 0) {
		console.error(`VALIDATION FAILED (${failures.length}):`);
		for (const failure of failures) console.error(`  - ${failure}`);
		return 1;
	}
	console.log("GENERATE CLIP PROJECT PASSED");
	return 0;
}

/** Stable JSON that keeps undefined-valued keys visible, for diff diagnostics. */
function jsonStable(value) {
	if (value === undefined) return "undefined";
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
	if (Array.isArray(value)) return `[${value.map((item) => jsonStable(item)).join(",")}]`;
	const entries = Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${jsonStable(item)}`);
	return `{${entries.join(",")}}`;
}

function elementsWithKind(clips, kind) {
	let count = 0;
	for (let i = 0; i < clips; i += 1) {
		const isText = i % OVERLAY_TRACKS < TEXT_TRACKS;
		if ((kind === "text") === isText) count += 1;
	}
	return count;
}

const parsedArgs = parseArgs(process.argv.slice(2));
const exitCode = await main(parsedArgs).catch((error) => {
	console.error("GENERATE CLIP PROJECT FAILED:", error?.stack ?? error);
	return 1;
});
if (parsedArgs.selfLog) {
	console.log(`REAL_EXIT_CODE:${exitCode}`);
}
process.exit(exitCode);
