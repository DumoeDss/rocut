import type {
	MvWetFloor,
	MvWetFloorPlan,
} from "../../packages/editor-contracts/src/mv-wet-floor";
import { renderWetFloor } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-wet-floor";
interface Reference {
	readonly id: "core/util.js" | "core/draw.js" | "scenes/night.js";
	readonly code: string;
	readonly sha256: string;
}
interface FontBytes {
	readonly resourceId: string;
	readonly bytes: ArrayBuffer;
}
interface OriginalScene {
	draw(ctx: CanvasRenderingContext2D, sample: unknown): void;
}
interface OriginalEngine {
	FONT: Record<string, string>;
	clock: unknown;
	canvas: (w: number, h: number) => HTMLCanvasElement;
	imgSync: (id: string) => HTMLCanvasElement;
	makeClock: (
		beats: readonly number[],
		bpm: number,
		downbeat: number,
	) => unknown;
	SCENES: Record<string, OriginalScene>;
}
function engine(value: unknown): value is OriginalEngine {
	return (
		typeof value === "object" &&
		value !== null &&
		"makeClock" in value &&
		typeof value.makeClock === "function" &&
		"SCENES" in value &&
		typeof value.SCENES === "object" &&
		value.SCENES !== null
	);
}
async function digest(bytes: ArrayBuffer): Promise<string> {
	return Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
		(v) => v.toString(16).padStart(2, "0"),
	).join("");
}
function canvas({
	width = 1920,
	height = 1080,
}: { width?: number; height?: number } = {}): HTMLCanvasElement {
	const c = document.createElement("canvas");
	c.width = width;
	c.height = height;
	return c;
}
function summarize(surfaces: readonly {
	readonly id?: string;
	readonly index?: number;
	readonly width: number;
	readonly height: number;
	readonly rgba: Uint8ClampedArray | undefined;
}[]): Array<{
	readonly id: string;
	readonly width: number;
	readonly height: number;
	readonly firstDiff?: { x: number; y: number; a: number; b: number };
}> {
	return surfaces.map((s) => ({ id: s.id ?? `#${s.index}`, width: s.width, height: s.height }));
}
function buildSurfaceComparison(
	nativeSurfaces: readonly {
		readonly id: string;
		readonly width: number;
		readonly height: number;
		readonly rgba: Uint8ClampedArray | undefined;
	}[],
	oracleSurfaces: readonly {
		readonly index: number;
		readonly width: number;
		readonly height: number;
		readonly rgba: Uint8ClampedArray;
	}[],
) {
	const comparisons: Array<{
		readonly id: string;
		readonly mismatchedPixels: number;
		readonly maxChannelError: number;
		readonly firstDiff: { x: number; y: number; c: number; a: number; b: number } | null;
		readonly probes: Array<{ x: number; y: number; a: readonly number[]; b: readonly number[] }>;
	}> = [];
	// Same-size oracle canvases are matched by creation order (the original
// engine creates asph then refl at identical sizes, so size-only matching
// would always pair every native surface with the asphalt canvas).
	const oracleBySize = new Map<string, { surface: (typeof oracleSurfaces)[number]; ordinal: number }[]>();
	for (const surface of oracleSurfaces) {
		const key = surface.width + "x" + surface.height;
		const list = oracleBySize.get(key) ?? [];
		list.push({ surface, ordinal: list.length });
		oracleBySize.set(key, list);
	}
	const consumed = new Map<string, number>();
	for (const nativeSurface of nativeSurfaces) {
		const key = nativeSurface.width + "x" + nativeSurface.height;
		const ordinal = consumed.get(key) ?? 0;
		consumed.set(key, ordinal + 1);
		const oracleSurface = oracleBySize.get(key)?.[ordinal]?.surface;
		if (!oracleSurface || !nativeSurface.rgba) continue;
		let surfaceMismatched = 0;
		let surfaceMax = 0;
		let firstDiff: { x: number; y: number; c: number; a: number; b: number } | null = null;
		for (let offset = 0; offset < nativeSurface.rgba.length; offset += 4) {
			let pixelMismatch = false;
			for (let channel = 0; channel < 4; channel++) {
				const error = Math.abs(
					nativeSurface.rgba[offset + channel] -
						oracleSurface.rgba[offset + channel],
				);
				if (error > 0) {
					surfaceMax = Math.max(surfaceMax, error);
					pixelMismatch = true;
					if (!firstDiff)
						firstDiff = {
							x: ((offset / 4) | 0) % nativeSurface.width,
							y: ((offset / 4) / nativeSurface.width) | 0,
									c: channel,
							a: nativeSurface.rgba[offset + channel],
							b: oracleSurface.rgba[offset + channel],
						};
				}
			}
			if (pixelMismatch) surfaceMismatched++;
		}
		comparisons.push({
			id: nativeSurface.id,
			mismatchedPixels: surfaceMismatched,
			maxChannelError: surfaceMax,
			firstDiff,
				probes: [[0, 0], [960, 297], [1342, 889], [1332, 458], [2000, 1000]].map(([x, y]) => {
					const i = ((y * nativeSurface.width) + x) * 4;
					return {
						x, y,
						a: [0, 1, 2, 3].map(k => nativeSurface.rgba?.[i + k] ?? -1),
						b: [0, 1, 2, 3].map(k => oracleSurface.rgba[i + k] ?? -1),
					};
				}),
		});
	}
	return {
		nativeSurfaceCount: nativeSurfaces.length,
		oracleWorldCanvasCount: oracleSurfaces.length,
		comparisons,
	};
}
/** Fixture-only real native-plan versus unchanged full original wetFloor draw.
 * The provider must call hash-pinned WASM, admit actual font bytes, and prepare
 * the fall mask from the supplied real Canvas2D RGBA; no authored mock plan. */
export async function compareWetFloorPixels({
	references,
	evaluateNativePlan,
	background,
	fontBytes,
	settings,
	beats,
	songTicks,
	shotStartTicks,
	shotEndTicks,
	maxChannelError = 1,
	surfaceDiagnostics = false,
	truncateOperations,
}: {
	readonly references: readonly Reference[];
	readonly evaluateNativePlan: (input: {
		readonly sampledRgba: Uint8ClampedArray;
	}) => Promise<MvWetFloorPlan>;
	readonly background: {
		readonly resourceId: string;
		readonly canvas: HTMLCanvasElement;
	};
	readonly fontBytes: readonly FontBytes[];
	readonly settings: MvWetFloor;
	readonly beats: readonly number[];
	readonly songTicks: number;
	readonly shotStartTicks: number;
	readonly shotEndTicks: number;
	readonly maxChannelError?: number;
	/** When true, captures per-surface dumps from both sides of the count case
	 * and attaches them to the thrown error / returned diagnostics. Fixture-only
	 * tooling for the consolidated pixel-acceptance phase. */
	readonly surfaceDiagnostics?: boolean;
	/** Fixture-only: render only the first N plan.operations (surfaces stay
	 * complete) to bisect the first divergent composition operation. */
	readonly truncateOperations?: number;
}) {
	if (
		references.length !== 3 ||
		new Set(references.map((r) => r.id)).size !== 3 ||
		!Number.isSafeInteger(songTicks) ||
		songTicks < 0 ||
		shotEndTicks <= shotStartTicks ||
		!Number.isInteger(maxChannelError) ||
		maxChannelError < 0 ||
		maxChannelError > 2
	)
		throw Error("Invalid wetFloor pixel gate inputs");
	for (const reference of references) {
		if (
			!/^[a-f0-9]{64}$/.test(reference.sha256) ||
			(await digest(new TextEncoder().encode(reference.code).buffer)) !==
				reference.sha256
		)
			throw Error("wetFloor original source identity mismatch");
	}
	const sampled = canvas({ width: 418, height: 235 });
	const sampleCtx = sampled.getContext("2d", { willReadFrequently: true });
	if (!sampleCtx) throw Error("wetFloor real pixel sample unavailable");
	sampleCtx.drawImage(background.canvas, 0, 0, 418, 235);
	const sampledRgba = sampleCtx.getImageData(0, 0, 418, 235).data;
	const plan = await evaluateNativePlan({ sampledRgba });
	if (
		plan.profile !== "night-wet-floor-v1" ||
		plan.songTicks !== songTicks ||
		plan.mode !== settings.mode
	)
		throw Error("wetFloor native frame identity mismatch");
	const native = canvas(),
		original = canvas(),
		iframe = document.createElement("iframe");
	const surfaceDumps: Array<{
		id: string;
		width: number;
		height: number;
		rgba: Uint8ClampedArray | undefined;
	}> = [];
	const nativeFaces: FontFace[] = [];
	iframe.hidden = true;
	iframe.title = "Independent original wetFloor pixel oracle";
	iframe.srcdoc =
		"<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; img-src 'none'; base-uri 'none'\"><body></body>";
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(Error("wetFloor oracle realm timeout")),
				5000,
			);
			iframe.onload = () => {
				clearTimeout(timer);
				resolve();
			};
			iframe.onerror = () => {
				clearTimeout(timer);
				reject(Error("wetFloor oracle realm failed"));
			};
			document.body.append(iframe);
		});
		const realm = iframe.contentWindow,
			doc = iframe.contentDocument;
		if (!realm || !doc) throw Error("wetFloor oracle realm inaccessible");
		let scriptError: Error | undefined;
		const onError = (event: ErrorEvent) => {
			scriptError = Error(event.message);
			event.preventDefault();
		};
		realm.addEventListener("error", onError);
		try {
			for (const id of ["core/util.js", "core/draw.js", "scenes/night.js"]) {
				const reference = references.find((r) => r.id === id);
				if (!reference) throw Error("Missing original source");
				const script = doc.createElement("script");
				script.textContent = reference.code;
				doc.body.append(script);
				if (scriptError) throw scriptError;
			}
		} finally {
			realm.removeEventListener("error", onError);
		}
		const originalEngine: unknown = Reflect.get(realm, "Z");
		if (!engine(originalEngine))
			throw Error("Original wetFloor engine unavailable");
		const worldCanvases: HTMLCanvasElement[] = [];
		const bindings: { resourceId: string; face: FontFace }[] = [];
		// Original family names and native aliases use identical real bytes. Both
		// weight instances are installed; generic serif is never the byte fallback.
		for (const stack of plan.fontStacks) {
			for (let index = 0; index < 2; index++) {
				const resource = stack.resources[index];
				const supplied = fontBytes.find((f) => f.resourceId === resource.id);
				if (
					!supplied ||
					!resource.font ||
					supplied.bytes.byteLength !== resource.byteLength ||
					(await digest(supplied.bytes)) !== resource.sha256
				)
					throw Error("wetFloor pixel font bytes mismatch");
				const descriptor = {
					weight: String(resource.font.weight),
					style: "normal",
					variationSettings:
						Object.entries(resource.font.axes ?? {})
							.map(([tag, value]) => `"${tag}" ${value}`)
							.join(",") || "normal",
				};
				const face = new FontFace(
					stack.aliases[index],
					supplied.bytes,
					descriptor,
				);
				await face.load();
				document.fonts.add(face);
				nativeFaces.push(face);
				bindings.push({ resourceId: resource.id, face });
				const originalFace = new FontFace(
					resource.font.family,
					supplied.bytes,
					descriptor,
				);
				await originalFace.load();
				doc.fonts.add(originalFace);
			}
		}
		originalEngine.FONT = {
			mincho: '"Shippori Mincho B1"',
			dot: '"DotGothic16"',
		};
		originalEngine.clock = originalEngine.makeClock(
			beats,
			settings.bpm,
			settings.downbeatIndex0,
		);
		originalEngine.canvas = (w, h) => {
			const c = doc.createElement("canvas");
			c.width = w;
			c.height = h;
			if (surfaceDiagnostics && settings.mode === "count" && w === 2112 && h === 1188)
				worldCanvases.push(c);
			return c;
		};
		originalEngine.imgSync = (id) => {
			if (id !== settings.bg) throw Error("Unexpected original image");
			return background.canvas;
		};
		// The unchanged original scene reaches drawPlateShimmer/drawImpact, which
		// read Z.scratch[0]/[1]; the engine only allocates them in main.js, which
		// this isolated oracle realm intentionally never loads. Provide the same
		// three full-frame scratch canvases the original engine allocates.
		originalEngine.scratch = [
			originalEngine.canvas(1920, 1080),
			originalEngine.canvas(1920, 1080),
			originalEngine.canvas(1920, 1080),
		];
		const ctx = original.getContext("2d", { willReadFrequently: true });
		if (!ctx) throw Error("wetFloor oracle Canvas2D unavailable");
		const scene = originalEngine.SCENES.wetFloor;
		if (!scene || typeof scene.draw !== "function")
			throw Error("Original wetFloor scene missing");
		const time = songTicks / 120000;
		const start = shotStartTicks / 120000;
		const end = shotEndTicks / 120000;
		scene.draw(ctx, {
			args: settings,
			t: time,
			p: Math.max(0, Math.min(1, (time - start) / (end - start))),
			shot: { id: "native-pixel-gate", t0: start, t1: end },
			clock: originalEngine.clock,
		});
		renderWetFloor({
			canvas: native,
			plan:
				truncateOperations === undefined
					? plan
					: { ...plan, operations: plan.operations.slice(0, truncateOperations) },
			image: { resourceId: background.resourceId, image: background.canvas },
			fonts: bindings,
			onSurface: surfaceDiagnostics
				? ({ id, canvas: c }) => {
						surfaceDumps.push({
							id,
							width: c.width,
							height: c.height,
							rgba: c
								.getContext("2d", { willReadFrequently: true })
								?.getImageData(0, 0, c.width, c.height)
								.data.slice(),
						});
					}
				: undefined,
		});
		const nativeCtx = native.getContext("2d", { willReadFrequently: true });
		if (!nativeCtx) throw Error("wetFloor native readback unavailable");
		const actual = nativeCtx.getImageData(0, 0, 1920, 1080).data;
		const expected = ctx.getImageData(0, 0, 1920, 1080).data;
		let max = 0,
			sum = 0,
			mismatchedPixels = 0;
		const samples: Array<{
			x: number;
			y: number;
			c: number;
			a: number;
			b: number;
			d: number;
		}> = [];
		const histogram = new Map<number, number>();
		const rowChanged = new Uint32Array(1080), colChanged = new Uint32Array(1920), chanDelta = [0, 0, 0, 0];
		let changedSamples = 0, deltaTotal = 0;
		for (let offset = 0; offset < actual.length; offset += 4) {
			let mismatch = false;
			for (let channel = 0; channel < 4; channel++) {
				const error = Math.abs(
					actual[offset + channel] - expected[offset + channel],
				);
				max = Math.max(max, error);
				sum += error;
				if (error > 0) {
					changedSamples++; deltaTotal += error; chanDelta[channel] += error;
					histogram.set(error, (histogram.get(error) ?? 0) + 1);
				}
				if (error > maxChannelError) mismatch = true;
				if (
					error > 0 &&
					samples.length < 16 &&
					mismatch
				) {
					const pixel = (offset / 4) | 0;
					samples.push({
						x: pixel % 1920,
						y: (pixel / 1920) | 0,
						c: channel,
						a: actual[offset + channel],
						b: expected[offset + channel],
						d: error,
					});
				}
			}
			if (mismatch) {
				mismatchedPixels++;
				rowChanged[(offset / 4 / 1920) | 0]++;
				colChanged[((offset / 4) | 0) % 1920]++;
			}
		}
		const band = (arr: Uint32Array) => { const out: number[] = []; for (let b = 0; b < 12; b++) { let s = 0; for (let i = Math.floor(b * arr.length / 12); i < Math.floor((b + 1) * arr.length / 12); i++) s += arr[i]; out.push(s); } return out; };
		const rowBands = band(rowChanged), colBands = band(colChanged);
		// 96x54 heat map of per-pixel channel-delta totals for fast visual triage.
		const heat: number[] = [];
		for (let hy = 0; hy < 54; hy++) {
			for (let hx = 0; hx < 96; hx++) {
				let cell = 0;
				for (let y = hy * 20; y < (hy + 1) * 20; y++) {
					const row = y * 1920;
					for (let x = hx * 20; x < (hx + 1) * 20; x++) {
						const o = (row + x) * 4;
						cell += Math.abs(actual[o] - expected[o]) + Math.abs(actual[o + 1] - expected[o + 1]) + Math.abs(actual[o + 2] - expected[o + 2]) + Math.abs(actual[o + 3] - expected[o + 3]);
					}
				}
				heat.push(cell);
			}
		}
		const heatMax = Math.max(...heat);
		// Anchor probes in the divergent heat regions for direct value comparison.
		const anchors: Array<{ x: number; y: number; a: number[]; b: number[] }> = [];
		if (settings.mode === "count")
			for (const [x, y] of [[100, 86], [300, 120], [960, 640], [1700, 850], [1800, 900], [952, 592]] as const) {
				const offset = (y * 1920 + x) * 4;
				anchors.push({ x, y, a: [0, 1, 2, 3].map(k => actual[offset + k]), b: [0, 1, 2, 3].map(k => expected[offset + k]) });
			}
		let heatMap = "";
		if (settings.mode === "count") {
			const shades = " .:-=+*#%@";
			for (let hy = 0; hy < 54; hy++) {
				for (let hx = 0; hx < 96; hx++)
					heatMap += shades[Math.min(9, Math.round(heat[hy * 96 + hx] / heatMax * 9))];
				heatMap += "|";
			}
		}
		let surfaceComparison: ReturnType<typeof buildSurfaceComparison> | undefined;
		if (surfaceDiagnostics && settings.mode === "count") {
			const oracleSurfaces = worldCanvases.map((c, i) => {
				const ctx2 = c.getContext("2d", { willReadFrequently: true });
				return {
					index: i,
					width: c.width,
					height: c.height,
					rgba: ctx2?.getImageData(0, 0, c.width, c.height).data.slice() as Uint8ClampedArray,
				};
			});
			surfaceComparison = buildSurfaceComparison(surfaceDumps, oracleSurfaces);
		}
		let opDump: unknown[] | undefined;
		let glowOps: unknown[] | undefined;
		let opBisect: Array<{ ops: number; mismatched: number }> | undefined;
		if (surfaceDiagnostics && settings.mode === "count") {
			opDump = plan.operations.slice(1160, 1205).map((operation, index) => ({ index: 1160 + index, ...operation }));
			glowOps = plan.operations
				.map((operation, index) => ({ operation, index }))
				.filter(({ operation }) => operation.op === "drawImage" && operation.image.kind === "surface" && String(operation.image.id).startsWith("glow-"))
				.map(({ operation, index }) => ({ index, id: operation.image.id, rect: operation.destinationRect }));
			opBisect = [];
			const total = plan.operations.length;
			const checkpoints: number[] = [];
			for (let k = 0; k <= 16; k++) checkpoints.push(Math.round((total * k) / 16));
			for (let ops = 1176; ops <= total; ops += 6) checkpoints.push(ops);
			checkpoints.sort((a, b) => a - b);
			for (const ops of [...new Set(checkpoints)]) {
				const partial = canvas();
				renderWetFloor({
					canvas: partial,
					plan: { ...plan, operations: plan.operations.slice(0, ops) },
					image: { resourceId: background.resourceId, image: background.canvas },
					fonts: bindings,
				});
				const partialCtx = partial.getContext("2d", { willReadFrequently: true });
				const partialData = partialCtx?.getImageData(0, 0, 1920, 1080).data;
				let partialMismatched = 0;
				if (partialData)
					for (let offset = 0; offset < partialData.length; offset += 4) {
						let pixelMismatch = false;
						for (let channel = 0; channel < 4; channel++)
							if (Math.abs(partialData[offset + channel] - expected[offset + channel]) > maxChannelError) {
								pixelMismatch = true;
								break;
							}
						if (pixelMismatch) partialMismatched++;
					}
				opBisect.push({ ops, mismatched: partialMismatched });
				partial.width = partial.height = 1;
			}
		}
		if (mismatchedPixels)
			throw Error(
`wetFloor ${settings.mode} pixel mismatch: ${mismatchedPixels} pixels, max channel error ${max}: ${JSON.stringify({ samples, rowBands, colBands, surfaceComparison, anchors, opBisect: opBisect ? opBisect.filter((_, i) => i % 3 === 0 || opBisect[i].ops >= 1180) : undefined, opDump, glowOps })}`,
			);
		if (surfaceDiagnostics && settings.mode === "count") {
			return {
				mode: settings.mode,
				pixels: 0,
				maxChannelError: 0,
				surfaceDiagnostics: surfaceComparison,
			};
		}
		return {
			mode: settings.mode,
			songTicks,
			operationCount: plan.operationCount,
			allocationBytes: plan.allocationBytes,
			maxChannelError: max,
			meanChannelError: sum / actual.length,
			mismatchedPixels,
			nativeRgba: actual,
			originalRgba: expected,
			surfaceDiagnostics: undefined,
		};
	} finally {
		for (const face of nativeFaces) document.fonts.delete(face);
		native.width =
			native.height =
			original.width =
			original.height =
			sampled.width =
			sampled.height =
				1;
		iframe.remove();
	}
}
