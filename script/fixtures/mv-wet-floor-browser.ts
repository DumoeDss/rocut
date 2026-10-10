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
			plan,
			image: { resourceId: background.resourceId, image: background.canvas },
			fonts: bindings,
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
		for (let offset = 0; offset < actual.length; offset += 4) {
			let mismatch = false;
			for (let channel = 0; channel < 4; channel++) {
				const error = Math.abs(
					actual[offset + channel] - expected[offset + channel],
				);
				max = Math.max(max, error);
				sum += error;
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
			if (mismatch) mismatchedPixels++;
		}
		if (mismatchedPixels)
			throw Error(
				`wetFloor ${settings.mode} pixel mismatch: ${mismatchedPixels} pixels, max channel error ${max}: ${JSON.stringify(samples)}`,
			);
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
