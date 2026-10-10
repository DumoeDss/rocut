import type {
	MvTrain,
	MvTrainPlan,
} from "../../packages/editor-contracts/src/mv-train";
import { renderTrainScene } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-train";
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
	scratch: HTMLCanvasElement[];
	canvas: (w: number, h: number) => HTMLCanvasElement;
	night: { post: { train: (s: unknown) => unknown } };
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
/** Fixture-only real native-plan versus unchanged full original train draw.
 * The provider must call hash-pinned WASM, admit actual font bytes, and
 * use actual decoded image dimensions; no authored mock plan. Scene pixels
 * are gated here. A separate required P4 original GL post gate must also pass. */
export async function compareTrainScenePixels({
	references,
	evaluateNativePlan,
	images,
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
		readonly actualImages: readonly {
			readonly resourceId: string;
			readonly width: number;
			readonly height: number;
		}[];
	}) => Promise<MvTrainPlan>;
	readonly images: readonly {
		readonly resourceId: string;
		readonly canvas: HTMLCanvasElement;
	}[];
	readonly fontBytes: readonly FontBytes[];
	readonly settings: MvTrain;
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
		throw Error("Invalid train pixel gate inputs");
	for (const reference of references) {
		if (
			!/^[a-f0-9]{64}$/.test(reference.sha256) ||
			(await digest(new TextEncoder().encode(reference.code).buffer)) !==
				reference.sha256
		)
			throw Error("train original source identity mismatch");
	}
	const plan = await evaluateNativePlan({
		actualImages: images.map((image) => ({
			resourceId: image.resourceId,
			width: image.canvas.width,
			height: image.canvas.height,
		})),
	});
	if (
		plan.profile !== "night-train-v1" ||
		plan.songTicks !== songTicks ||
		plan.post.required !== true
	)
		throw Error("train native frame identity mismatch");
	const native = canvas(),
		original = canvas(),
		iframe = document.createElement("iframe");
	const nativeFaces: FontFace[] = [];
	iframe.hidden = true;
	iframe.title = "Independent original train pixel oracle";
	iframe.srcdoc =
		"<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; img-src 'none'; base-uri 'none'\"><body></body>";
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(Error("train oracle realm timeout")),
				5000,
			);
			iframe.onload = () => {
				clearTimeout(timer);
				resolve();
			};
			iframe.onerror = () => {
				clearTimeout(timer);
				reject(Error("train oracle realm failed"));
			};
			document.body.append(iframe);
		});
		const realm = iframe.contentWindow,
			doc = iframe.contentDocument;
		if (!realm || !doc) throw Error("train oracle realm inaccessible");
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
			throw Error("Original train engine unavailable");
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
					throw Error("train pixel font bytes mismatch");
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
			const image = images.find((image) => image.resourceId === id);
			if (!image) throw Error("Unexpected original image");
			return image.canvas;
		};
		originalEngine.scratch = [
			originalEngine.canvas(1920, 1080),
			originalEngine.canvas(1920, 1080),
			originalEngine.canvas(1920, 1080),
		];
		const ctx = original.getContext("2d", { willReadFrequently: true });
		if (!ctx) throw Error("train oracle Canvas2D unavailable");
		const scene = originalEngine.SCENES.train;
		if (!scene || typeof scene.draw !== "function")
			throw Error("Original train scene missing");
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
		renderTrainScene({
			canvas: native,
			plan,
			images: images.map((image) => ({
				resourceId: image.resourceId,
				image: image.canvas,
			})),
			fonts: bindings,
		});
		const originalPost: unknown = originalEngine.night.post.train({
			args: settings,
			t: time,
		});
		if (typeof originalPost !== "object" || originalPost === null)
			throw Error("Original Train post helper unavailable");
		for (const [key, value] of Object.entries(plan.post)) {
			if (key !== "required" && Reflect.get(originalPost, key) !== value)
				throw Error("Train required original post intent mismatch: " + key);
		}
		const nativeCtx = native.getContext("2d", { willReadFrequently: true });
		if (!nativeCtx) throw Error("train native readback unavailable");
		const actual = nativeCtx.getImageData(0, 0, 1920, 1080).data;
		const expected = ctx.getImageData(0, 0, 1920, 1080).data;
		let max = 0,
			sum = 0,
			mismatchedPixels = 0;
		for (let offset = 0; offset < actual.length; offset += 4) {
			let mismatch = false;
			for (let channel = 0; channel < 4; channel++) {
				const error = Math.abs(
					actual[offset + channel] - expected[offset + channel],
				);
				max = Math.max(max, error);
				sum += error;
				if (error > maxChannelError) mismatch = true;
			}
			if (mismatch) mismatchedPixels++;
		}
		if (mismatchedPixels)
			throw Error(
				`train scene pixel mismatch: ${mismatchedPixels} pixels, max channel error ${max}`,
			);
		return {
			scene: "train",
			postGateRequired: true,
			postIntent: plan.post,
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
		native.width = native.height = original.width = original.height = 1;
		iframe.remove();
	}
}
