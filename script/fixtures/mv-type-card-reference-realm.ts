import {
	TYPE_CARD_REFERENCE_FILES,
	type TypeCardOriginalWindow,
	type TypeCardReference,
} from "./mv-type-card-reference-contract";

export async function typeCardReferenceDigest(bytes: ArrayBuffer) {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

/** Complete upstream scripts in their own namespace; no URL assets or network. */
export async function openTypeCardRealm(reference: TypeCardReference) {
	if (
		reference.version !== 1 ||
		reference.scripts.length !== TYPE_CARD_REFERENCE_FILES.length
	)
		throw Error("Unexpected typeCard reference payload");
	// Snapshot before hashing: the caller cannot change which bytes get executed.
	const scripts = reference.scripts.map(({ id, code, sha256 }) => ({
		id,
		code,
		sha256,
	}));
	for (const [index, script] of scripts.entries()) {
		if (
			script.id !== TYPE_CARD_REFERENCE_FILES[index] ||
			(await typeCardReferenceDigest(
				new TextEncoder().encode(script.code).buffer,
			)) !== script.sha256
		)
			throw Error(`typeCard source identity mismatch: ${script.id}`);
	}
	const iframe = document.createElement("iframe");
	iframe.hidden = true;
	iframe.title = "Isolated original typeCard oracle";
	iframe.srcdoc = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; img-src 'none'; base-uri https://rocut-oracle.invalid">
<base href="https://rocut-oracle.invalid/"><body></body>`;
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(Error("typeCard oracle iframe timed out")),
				5000,
			);
			iframe.onload = () => {
				clearTimeout(timer);
				resolve();
			};
			iframe.onerror = () => {
				clearTimeout(timer);
				reject(Error("typeCard oracle iframe failed"));
			};
			document.body.append(iframe);
		});
		const realm = iframe.contentWindow as TypeCardOriginalWindow | null;
		if (!realm?.document)
			throw Error("typeCard oracle iframe is not locally accessible");
		let scriptError: Error | undefined;
		const onError = (event: ErrorEvent) => {
			scriptError = Error(`Original typeCard script failed: ${event.message}`);
			event.preventDefault();
		};
		realm.addEventListener("error", onError);
		try {
			for (const source of scripts) {
				const script = realm.document.createElement("script");
				script.textContent = source.code;
				realm.document.body.append(script);
				if (scriptError) throw scriptError;
			}
		} finally {
			realm.removeEventListener("error", onError);
		}
		const engine = realm.Z;
		if (
			!engine?.SCENES.typeCard ||
			typeof engine.canvas !== "function" ||
			!engine.FONT
		)
			throw Error("Original typeCard scene did not register");
		// This is the exact allocation performed by upstream core/main.js.
		engine.scratch = [
			engine.canvas(1920, 1080),
			engine.canvas(1920, 1080),
			engine.canvas(1920, 1080),
		];
		return {
			iframe,
			realm,
			engine,
			scene: engine.SCENES.typeCard,
			scriptIdentity: scripts.map(({ id, sha256 }) => ({ id, sha256 })),
		};
	} catch (error) {
		iframe.remove();
		throw error;
	}
}
