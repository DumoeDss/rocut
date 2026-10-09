import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256 } from "./master-encoder-analysis.mjs";

export function sourceIdentities({ root, policyResolver }) {
	const tracked = [
		"script/probe-vp9-quantizer-source.mjs",
		"script/fixtures/vp9-quantizer-source-identities.mjs",
		...[
			"cases.mjs",
			"browser.mjs",
			"decode.mjs",
			"io.mjs",
			"assertions.mjs",
			"rust-plan.mjs",
			"audio.mjs",
			"audio.test.mjs",
			"audio-followup.mjs",
			"cases.test.mjs",
		].map((suffix) => `script/fixtures/vp9-quantizer-source-${suffix}`),
		...["source", "platform", "writes"].map(
			(suffix) =>
				`packages/editor-classic/src/services/renderer/export-vp9-quantizer-${suffix}.ts`,
		),
		"packages/editor-classic/src/services/renderer/export-cancellation.ts",
		"script/fixtures/master-encoder-analysis.mjs",
		"script/fixtures/master-encoder-quantizer-cases.mjs",
		"script/fixtures/master-encoder-quantizer-io.mjs",
		"script/fixtures/master-effects-browser-oracle.ts",
		"script/browser-probe-toolchain.mjs",
		"node_modules/mediabunny/package.json",
		"bun.lock",
		...(policyResolver
			? [
					"rust/crates/editor-api/src/video_export.rs",
					"rust/crates/editor-api/src/video_export/vp9.rs",
					"rust/crates/editor-api/src/video_export/quantizer.rs",
					"rust/crates/editor-api/tests/video_export.rs",
					"rust/crates/editor-api/examples/vp9-quantizer-policy.rs",
				]
			: []),
	];
	return Promise.all(
		tracked.map(async (path) => ({
			path,
			sha256: sha256(await readFile(join(root, path))),
		})),
	);
}

export function bundledSourceIdentities({ root, metafile }) {
	return Promise.all(
		Object.keys(metafile.inputs)
			.sort()
			.map(async (path) => ({
				path,
				sha256: path.startsWith("(disabled):")
					? null
					: sha256(await readFile(resolve(root, path))),
			})),
	);
}

export async function binaryIdentity(path) {
	const hash = createHash("sha256");
	for await (const bytes of createReadStream(path)) hash.update(bytes);
	return { path, sha256: hash.digest("hex") };
}
