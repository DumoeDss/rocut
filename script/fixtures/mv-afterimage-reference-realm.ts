import {
	AFTERIMAGE_FONT_FACES,
	AFTERIMAGE_REFERENCE_FILES,
	type AfterimageReference,
	type AfterimageReferenceFonts,
} from "./mv-afterimage-reference-contract";

interface OriginalScene {
	preload(args: Record<string, unknown>): string[];
	init(): Promise<unknown>;
	draw(ctx: CanvasRenderingContext2D, state: Record<string, unknown>): unknown;
}
interface OriginalEngine {
	loaded: Map<string, ImageBitmap>;
	SCENES: Record<string, OriginalScene>;
}
type OriginalWindow = Window & typeof globalThis & { Z?: OriginalEngine };

export async function referenceDigest(bytes: ArrayBuffer): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

/** Own namespace and caches; CSP blocks all URL-based assets and network access. */
export async function openAfterimageRealm(reference: AfterimageReference) {
	if (
		reference.version !== 1 ||
		reference.scripts.length !== AFTERIMAGE_REFERENCE_FILES.length
	)
		throw Error("Unexpected afterimage reference payload");
	const scripts = reference.scripts.map(({ id, code, sha256 }) => ({
		id,
		code,
		sha256,
	}));
	for (const [index, script] of scripts.entries()) {
		if (
			script.id !== AFTERIMAGE_REFERENCE_FILES[index] ||
			(await referenceDigest(new TextEncoder().encode(script.code).buffer)) !==
				script.sha256
		)
			throw Error(`Afterimage source identity mismatch: ${script.id}`);
	}
	const iframe = document.createElement("iframe");
	iframe.hidden = true;
	iframe.title = "Isolated original afterimage oracle";
	iframe.srcdoc = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; img-src 'none'; base-uri https://rocut-oracle.invalid">
<base href="https://rocut-oracle.invalid/"><body></body>`;
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(Error("Oracle iframe timed out")),
				5000,
			);
			iframe.onload = () => {
				clearTimeout(timer);
				resolve();
			};
			iframe.onerror = () => {
				clearTimeout(timer);
				reject(Error("Oracle iframe failed"));
			};
			document.body.append(iframe);
		});
		const realm = iframe.contentWindow as OriginalWindow | null;
		if (!realm?.document)
			throw Error("Oracle iframe is not locally accessible");
		let scriptError: Error | undefined;
		const onError = (event: ErrorEvent) => {
			scriptError = Error(
				`Original afterimage script failed: ${event.message}`,
			);
			event.preventDefault();
		};
		realm.addEventListener("error", onError);
		try {
			for (const original of scripts) {
				const script = realm.document.createElement("script");
				script.textContent = original.code;
				realm.document.body.append(script);
				if (scriptError) throw scriptError;
			}
		} finally {
			realm.removeEventListener("error", onError);
		}
		const engine = realm.Z;
		if (!engine?.SCENES.afterimage || !(engine.loaded instanceof realm.Map))
			throw Error("Original afterimage scene did not register");
		return {
			iframe,
			realm,
			engine,
			scene: engine.SCENES.afterimage,
			scriptIdentity: scripts.map(({ id, sha256 }) => ({ id, sha256 })),
		};
	} catch (error) {
		iframe.remove();
		throw error;
	}
}

export async function loadAfterimageFonts(
	realm: OriginalWindow,
	fonts: AfterimageReferenceFonts,
) {
	return Promise.all(
		AFTERIMAGE_FONT_FACES.map(async (definition) => {
			const supplied = fonts[definition.role];
			if (!(supplied instanceof ArrayBuffer) || !supplied.byteLength)
				throw Error(`Missing local font bytes: ${definition.role}`);
			const bytes = supplied.slice(0);
			const face = new realm.FontFace(definition.family, bytes, {
				weight: definition.weight,
				style: "normal",
			});
			await face.load();
			realm.document.fonts.add(face);
			const spec = `${definition.weight} 100px "${definition.family}"`;
			const loaded = await realm.document.fonts.load(spec, definition.sample);
			if (
				face.status !== "loaded" ||
				!loaded.includes(face) ||
				!realm.document.fonts.check(spec, definition.sample)
			)
				throw Error(`Original afterimage font unavailable: ${definition.role}`);
			return { ...definition, sha256: await referenceDigest(bytes) };
		}),
	);
}
