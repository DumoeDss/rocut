import {
	INK_REFERENCE_FILES,
	type InkEngine,
	type InkImage,
	type InkReference,
} from "./mv-ink-contract";

export async function inkDigest(body: ArrayBuffer): Promise<string> {
	return Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
		(byte) => byte.toString(16).padStart(2, "0"),
	).join("");
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function originalEngine(value: unknown): value is InkEngine {
	if (!record(value) || !record(value.SCENES) || !record(value.loaded))
		return false;
	const { SCENES, loaded } = value;
	return (
		["makeClock", "canvas"].every((key) => typeof value[key] === "function") &&
		["get", "set", "has"].every((key) => typeof loaded[key] === "function") &&
		["thread", "fall", "flame", "ink"].every((key) => {
			const scene = SCENES[key];
			return (
				record(scene) &&
				typeof scene.preload === "function" &&
				typeof scene.draw === "function"
			);
		})
	);
}
export async function validateInkIdentities({
	reference,
	images,
}: {
	reference: InkReference;
	images: readonly InkImage[];
}): Promise<void> {
	if (
		reference.version !== 1 ||
		reference.scripts.length !== INK_REFERENCE_FILES.length
	)
		throw Error("Incomplete Ink original source");
	for (const [index, source] of reference.scripts.entries())
		if (
			source.id !== INK_REFERENCE_FILES[index] ||
			(await inkDigest(new TextEncoder().encode(source.code).buffer)) !==
				source.sha256
		)
			throw Error("Ink original script identity mismatch");
	const ids = new Set<string>();
	for (const image of images) {
		if (
			!image.id ||
			ids.has(image.id) ||
			image.mimeType !== "image/png" ||
			image.byteLength !== image.body.byteLength ||
			!Number.isSafeInteger(image.width) ||
			image.width <= 0 ||
			!Number.isSafeInteger(image.height) ||
			image.height <= 0 ||
			(await inkDigest(image.body)) !== image.sha256
		)
			throw Error("Ink original resource identity mismatch");
		ids.add(image.id);
	}
}
/** Separate unchanged-original realm; no native renderer, producer or expected math imports. */
export async function openInkRealm({
	reference,
	images,
}: {
	reference: InkReference;
	images: readonly InkImage[];
}) {
	const iframe = document.createElement("iframe");
	iframe.hidden = true;
	iframe.title = "Complete unchanged original Ink oracle";
	iframe.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri https://rocut-oracle.invalid"><base href="https://rocut-oracle.invalid/"><body></body>`;
	const bitmaps: ImageBitmap[] = [];
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const bitmap of bitmaps) bitmap.close();
		bitmaps.length = 0;
		iframe.remove();
	};
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(Error("Ink original realm timed out")),
				5000,
			);
			iframe.onload = () => {
				clearTimeout(timer);
				resolve();
			};
			iframe.onerror = () => {
				clearTimeout(timer);
				reject(Error("Ink original realm failed"));
			};
			document.body.append(iframe);
		});
		const realm = iframe.contentWindow;
		if (!realm?.document) throw Error("Ink original realm inaccessible");
		let scriptError: Error | undefined;
		const onError = (event: ErrorEvent) => {
			scriptError = Error(`Original Ink: ${event.message}`);
			event.preventDefault();
		};
		realm.addEventListener("error", onError);
		try {
			for (const source of reference.scripts) {
				const script = realm.document.createElement("script");
				script.textContent = source.code;
				realm.document.body.append(script);
				if (scriptError) throw scriptError;
			}
		} finally {
			realm.removeEventListener("error", onError);
		}
		const engine: unknown = Reflect.get(realm, "Z");
		if (!originalEngine(engine))
			throw Error("Complete original Ink registration missing");
		for (const image of images) {
			const bitmap = await realm.createImageBitmap(
				new Blob([image.body], { type: image.mimeType }),
				{
					premultiplyAlpha: "default",
					colorSpaceConversion: "none",
				},
			);
			bitmaps.push(bitmap);
			if (bitmap.width !== image.width || bitmap.height !== image.height)
				throw Error("Ink declared/decoded dimensions mismatch");
			engine.loaded.set(image.id, bitmap);
		}
		return { engine, dispose, isDisposed: () => disposed };
	} catch (error) {
		dispose();
		throw error;
	}
}
