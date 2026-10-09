import {
	CONVERGE_REFERENCE_FILES,
	type ConvergeReference,
	type ConvergeOriginalWindow,
} from "./mv-converge-reference-contract";
export async function convergeReferenceDigest(bytes: ArrayBuffer) {
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function openConvergeRealm(reference: ConvergeReference) {
	if (
		reference.version !== 1 ||
		reference.scripts.length !== CONVERGE_REFERENCE_FILES.length
	)
		throw Error("Unexpected converge reference payload");
	const scripts = reference.scripts.map(({ id, code, sha256 }) => ({
		id,
		code,
		sha256,
	}));
	for (const [index, script] of scripts.entries()) {
		if (
			script.id !== CONVERGE_REFERENCE_FILES[index] ||
			(await convergeReferenceDigest(
				new TextEncoder().encode(script.code).buffer,
			)) !== script.sha256
		)
			throw Error(`Converge source identity mismatch: ${script.id}`);
	}
	const iframe = document.createElement("iframe");
	iframe.hidden = true;
	iframe.title = "Isolated original converge oracle";
	iframe.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; img-src 'none'; base-uri https://rocut-oracle.invalid"><base href="https://rocut-oracle.invalid/"><body></body>`;
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(Error("Converge oracle iframe timed out")),
				5000,
			);
			iframe.onload = () => {
				clearTimeout(timer);
				resolve();
			};
			iframe.onerror = () => {
				clearTimeout(timer);
				reject(Error("Converge oracle iframe failed"));
			};
			document.body.append(iframe);
		});
		const realm = iframe.contentWindow as ConvergeOriginalWindow | null;
		if (!realm?.document) throw Error("Converge oracle realm inaccessible");
		let error: Error | undefined;
		const onError = (event: ErrorEvent) => {
			error = Error(`Original converge script: ${event.message}`);
			event.preventDefault();
		};
		realm.addEventListener("error", onError);
		try {
			for (const source of scripts) {
				const element = realm.document.createElement("script");
				element.textContent = source.code;
				realm.document.body.append(element);
				if (error) throw error;
			}
		} finally {
			realm.removeEventListener("error", onError);
		}
		const engine = realm.Z;
		if (
			!engine?.SCENES.converge ||
			typeof engine.makeClock !== "function" ||
			typeof engine.canvas !== "function"
		)
			throw Error("Full converge scene and beat clock did not register");
		return {
			iframe,
			realm,
			engine,
			scene: engine.SCENES.converge,
			scripts: scripts.map(({ id, sha256 }) => ({ id, sha256 })),
		};
	} catch (error) {
		iframe.remove();
		throw error;
	}
}
