import {
	KANJI_SLAM_REFERENCE_FILES,
	type KanjiSlamReference,
	type KanjiSlamEngine,
} from "./mv-kanji-slam-reference-contract";

export async function kanjiDigest(bytes: ArrayBuffer) {
	return Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
		(n) => n.toString(16).padStart(2, "0"),
	).join("");
}

export function snapshotKanjiReference(
	reference: KanjiSlamReference,
): KanjiSlamReference {
	if (
		reference.version !== 1 ||
		!Array.isArray(reference.scripts) ||
		reference.scripts.length !== KANJI_SLAM_REFERENCE_FILES.length
	)
		throw Error("Unexpected kanjiSlam reference payload");
	const scripts = reference.scripts.map(({ id, code, sha256 }, index) => {
		if (
			id !== KANJI_SLAM_REFERENCE_FILES[index] ||
			typeof code !== "string" ||
			!code.length ||
			code.length > 1_000_000 ||
			!/^[a-f0-9]{64}$/.test(sha256)
		)
			throw Error("Invalid complete kanjiSlam source identity/order");
		return { id, code, sha256 };
	});
	return { version: 1, scripts };
}

/** A fresh realm owns the original caches and clock. No extraction or patched math. */
export async function openKanjiRealm(input: KanjiSlamReference) {
	const reference = snapshotKanjiReference(input);
	for (const source of reference.scripts)
		if (
			(await kanjiDigest(new TextEncoder().encode(source.code).buffer)) !==
			source.sha256
		)
			throw Error(`kanjiSlam source identity mismatch: ${source.id}`);
	const iframe = document.createElement("iframe");
	iframe.hidden = true;
	iframe.title = "Complete original kanjiSlam oracle";
	iframe.srcdoc = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; img-src 'none'; base-uri https://rocut-oracle.invalid">
<base href="https://rocut-oracle.invalid/"><body></body>`;
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(Error("kanjiSlam realm timed out")),
				5000,
			);
			iframe.onload = () => {
				clearTimeout(timer);
				resolve();
			};
			iframe.onerror = () => {
				clearTimeout(timer);
				reject(Error("kanjiSlam realm failed"));
			};
			document.body.append(iframe);
		});
		const realm = iframe.contentWindow as
			| (Window & typeof globalThis & { Z?: KanjiSlamEngine })
			| null;
		if (!realm?.document) throw Error("kanjiSlam realm is inaccessible");
		let scriptError: Error | undefined;
		const onError = (event: ErrorEvent) => {
			scriptError = Error(`Original kanjiSlam script: ${event.message}`);
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
		const engine = realm.Z,
			scene = engine?.SCENES.kanjiSlam;
		if (
			!engine?.SCENES.typeCard ||
			!engine.SCENES.tunnel ||
			!scene ||
			typeof scene.preload !== "function" ||
			typeof scene.init !== "function" ||
			typeof engine.canvas !== "function" ||
			typeof engine.makeClock !== "function" ||
			!engine.FONT ||
			!engine.loaded
		)
			throw Error("Complete original typo.js registration missing");
		engine.scratch = [
			engine.canvas(1920, 1080),
			engine.canvas(1920, 1080),
			engine.canvas(1920, 1080),
		];
		return {
			iframe,
			realm,
			engine,
			scene,
			scripts: reference.scripts.map(({ id, sha256 }) => ({ id, sha256 })),
		};
	} catch (error) {
		iframe.remove();
		throw error;
	}
}
