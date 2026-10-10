import type {
	MvLutAtlasPlan,
	MvLutAtlasRowSample,
} from "../../packages/editor-contracts/src/mv-lut-atlas";
import {
	renderLutAtlas,
	readLutAtlasRow,
	releaseLutAtlas,
} from "../../packages/editor-classic/src/services/renderer/programmatic/mv-lut-atlas";
interface ImageBytes {
	readonly path: string;
	readonly resourceId: string;
	readonly bytes: ArrayBuffer;
	readonly sha256: string;
}
async function digest(bytes: ArrayBuffer): Promise<string> {
	return Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
		(v) => v.toString(16).padStart(2, "0"),
	).join("");
}
interface OriginalAtlas {
	readonly LUT: Record<string, number>;
	readonly lutAtlas: HTMLCanvasElement;
}
function originalAtlas(value: unknown): value is OriginalAtlas {
	return (
		typeof value === "object" &&
		value !== null &&
		"LUT" in value &&
		typeof value.LUT === "object" &&
		value.LUT !== null &&
		"lutAtlas" in value &&
		typeof value.lutAtlas === "object" &&
		value.lutAtlas !== null &&
		"getContext" in value.lutAtlas &&
		typeof value.lutAtlas.getContext === "function"
	);
}
/** Executes only the exact original buildLutAtlas function in an isolated
 * fixture realm. The caller's real hash-pinned WASM admits JSON/PNG bytes and
 * actual decoded facts; no fixture-authored native plan or JS palette policy. */
export async function compareLutAtlasPixels({
	reference,
	palette,
	images,
	evaluateNativePlan,
	requiredAlias = "P4",
}: {
	readonly reference: {
		readonly id: "core/main.js";
		readonly code: string;
		readonly sha256: string;
	};
	readonly palette: {
		readonly resourceId: string;
		readonly bytes: ArrayBuffer;
		readonly sha256: string;
	};
	readonly images: readonly ImageBytes[];
	readonly evaluateNativePlan: (facts: {
		readonly images: readonly {
			readonly resourceId: string;
			readonly width: number;
			readonly height: number;
		}[];
		readonly requiredAlias: string;
	}) => Promise<{
		readonly plan: MvLutAtlasPlan;
		readonly sample: MvLutAtlasRowSample;
	}>;
	readonly requiredAlias?: string;
}) {
	if (
		reference.id !== "core/main.js" ||
		(await digest(new TextEncoder().encode(reference.code).buffer)) !==
			reference.sha256 ||
		(await digest(palette.bytes)) !== palette.sha256
	)
		throw Error("LUT atlas original/document byte identity mismatch");
	const marker = "  async function buildLutAtlas() {";
	const endMarker =
		"  // ---------------------------------------------------------------- shots";
	const start = reference.code.indexOf(marker);
	const end = reference.code.indexOf(endMarker, start);
	if (
		start < 0 ||
		end < 0 ||
		reference.code.indexOf(marker, start + marker.length) >= 0
	)
		throw Error("LUT atlas original function boundary mismatch");
	const originalFunction = reference.code.slice(start, end).trim();
	const decoded: {
		path: string;
		resourceId: string;
		sha256: string;
		image: ImageBitmap;
		width: number;
		height: number;
	}[] = [];
	const iframe = document.createElement("iframe");
	iframe.hidden = true;
	iframe.title = "Independent original LUT atlas pixel oracle";
	iframe.srcdoc =
		"<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'\"><body></body>";
	let native: ReturnType<typeof renderLutAtlas> | undefined;
	try {
		for (const input of images) {
			if ((await digest(input.bytes)) !== input.sha256)
				throw Error("LUT atlas actual PNG byte identity mismatch");
			const image = await createImageBitmap(
				new Blob([input.bytes], { type: "image/png" }),
			);
			decoded.push({
				path: input.path,
				resourceId: input.resourceId,
				sha256: input.sha256,
				image,
				width: image.width,
				height: image.height,
			});
		}
		const { plan, sample } = await evaluateNativePlan({
			images: decoded.map((image) => ({
				resourceId: image.resourceId,
				width: image.width,
				height: image.height,
			})),
			requiredAlias,
		});
		if (
			plan.paletteResource.id !== palette.resourceId ||
			plan.paletteResource.sha256 !== palette.sha256 ||
			plan.aliases[requiredAlias] !== sample.row ||
			sample.atlasSha256 !== plan.atlasSha256
		)
			throw Error("LUT atlas real native plan/sample binding mismatch");
		native = renderLutAtlas({ plan, images: decoded });
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(Error("LUT atlas oracle realm timeout")),
				5000,
			);
			iframe.onload = () => {
				clearTimeout(timer);
				resolve();
			};
			iframe.onerror = () => {
				clearTimeout(timer);
				reject(Error("LUT atlas oracle realm failed"));
			};
			document.body.append(iframe);
		});
		const realm = iframe.contentWindow,
			doc = iframe.contentDocument;
		if (!realm || !doc) throw Error("LUT atlas oracle realm inaccessible");
		const Z = {
			canvas: (width: number, height: number) => {
				const c = doc.createElement("canvas");
				c.width = width;
				c.height = height;
				return c;
			},
			img: async (path: string) => {
				const input = decoded.find((image) => image.path === path);
				if (!input) throw Error("Original LUT image missing");
				return input.image;
			},
			post: { setLutAtlas: (_canvas: HTMLCanvasElement) => {} },
		};
		Reflect.set(realm, "Z", Z);
		Reflect.set(realm, "loadJSON", async (path: string) => {
			if (path !== "assets/style/palettes.json")
				throw Error("Unexpected original JSON path");
			return JSON.parse(
				new TextDecoder("utf-8", { fatal: true })
					.decode(palette.bytes)
					.replace(/^\uFEFF/, ""),
			);
		});
		let scriptError: Error | undefined;
		const onError = (event: ErrorEvent) => {
			scriptError = Error(event.message);
			event.preventDefault();
		};
		realm.addEventListener("error", onError);
		try {
			const script = doc.createElement("script");
			script.textContent = `window.__buildLutAtlas = ${originalFunction};`;
			doc.body.append(script);
			if (scriptError) throw scriptError;
		} finally {
			realm.removeEventListener("error", onError);
		}
		const build: unknown = Reflect.get(realm, "__buildLutAtlas");
		if (typeof build !== "function")
			throw Error("Original LUT atlas builder unavailable");
		await build();
		const original: unknown = Reflect.get(realm, "Z");
		if (!originalAtlas(original)) throw Error("Original LUT atlas absent");
		for (const [alias, row] of Object.entries(plan.aliases)) {
			if (original.LUT[alias] !== row)
				throw Error("Native LUT alias differs from original: " + alias);
		}
		if (Object.keys(original.LUT).length !== Object.keys(plan.aliases).length)
			throw Error("Native LUT alias set differs from original");
		const actual = native.canvas
			.getContext("2d", { willReadFrequently: true })
			?.getImageData(0, 0, 256, 16).data;
		const expected = original.lutAtlas
			.getContext("2d", { willReadFrequently: true })
			?.getImageData(0, 0, 256, 16).data;
		if (!actual || !expected)
			throw Error("LUT atlas real pixel readback unavailable");
		let max = 0,
			mismatchedChannels = 0;
		for (let index = 0; index < actual.length; index++) {
			const error = Math.abs(actual[index] - expected[index]);
			max = Math.max(max, error);
			if (error !== 0) mismatchedChannels++;
		}
		if (mismatchedChannels)
			throw Error(
				`LUT atlas pixel mismatch: ${mismatchedChannels} channels, max error ${max}`,
			);
		const rowRgba = readLutAtlasRow({ atlas: native, sample });
		return {
			profile: plan.profile,
			atlasSha256: plan.atlasSha256,
			paletteSha256: palette.sha256,
			usedRows: plan.usedRows,
			requiredAlias,
			requiredRow: sample.row,
			rowSourceSha256: sample.sourceResource?.sha256 ?? null,
			maxChannelError: max,
			mismatchedChannels,
			nativeRgba: actual,
			originalRgba: expected,
			rowRgba,
			sample,
		};
	} finally {
		if (native) releaseLutAtlas({ atlas: native });
		for (const image of decoded) image.image.close();
		iframe.remove();
	}
}
