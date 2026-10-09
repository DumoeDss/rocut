import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { treeManifest } from "../particle-c4-export-support.mjs";

export function exactCredentialMatch(bytes, secrets) {
	return [...secrets].some(
		(secret) =>
			typeof secret === "string" &&
			secret.length > 0 &&
			bytes.includes(Buffer.from(secret)),
	);
}

export async function scanParticleCredentials(
	root,
	secrets,
	excludedFiles = [],
) {
	const excluded = new Set(excludedFiles);
	const manifest = await treeManifest(root);
	const inspected = manifest.files.filter((entry) => !excluded.has(entry.path));
	const leaks = [];
	for (const entry of inspected) {
		if (exactCredentialMatch(await readFile(join(root, entry.path)), secrets))
			leaks.push(entry.path);
	}
	return {
		exactKnownHostSecretScan: secrets.size > 0,
		knownSecrets: secrets.size,
		filesScanned: inspected.length,
		excludedPrivateDescriptorFiles: [...excluded],
		leaks,
		scope:
			"Exact bytes of every observed current-run Host token and editor URL; no prior-session credentials used",
	};
}
