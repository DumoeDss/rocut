import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
	assertContained,
	collectDropletsInputs,
	sha256,
} from "./probe-droplets-evidence.mjs";

export const highChromaFixtureNames = [
	"high-chroma-contract.ts",
	"high-chroma-reference.ts",
	"high-chroma-scenes.ts",
	"high-chroma-decode.ts",
	"high-chroma-export.ts",
	"high-chroma-pipeline.ts",
	"high-chroma-entry.ts",
	"high-chroma-pipeline.html",
].map((name) => `script/fixtures/${name}`);
export const frozenDropletsReferences = Object.freeze({
	"droplets-cases.ts":
		"47ea803d3e902fa8c8dbde300b53d5ad3217f2df06689217467db09db6b2c037",
	"droplets-oracle.ts":
		"a6d34fced420e972d0b12c59ff2246d1ec4f5dceb80b7dc54ea7f98aa5a198ed",
	"droplets-oracle-time.ts":
		"abc5544e27c612a311f34942ed170e49f821cd15b3d314e84b95fc6c87a17b3b",
	"droplets-pipeline-cases.ts":
		"39c3ea6c4f079f2d9b2e0a6b0eedfc86be87a4171f1206aaa1767a1377bdac0a",
	"droplets-pipeline-scenes.ts":
		"69c1be3e3869bdcb4ba0347ba18a721254708d01227ea63f71d37b39b2946ea4",
	"droplets-pipeline-support.ts":
		"62478981f392607f1dc6cedca86835ad5abe3337d8636e73fcd3fff3d1592184",
	"droplets-pipeline-export.ts":
		"4cba8e04ce8ebd7d16dacdb2c91e89eb8e5ca44daa2b27dae3f212ade46ee4de",
});

export async function collectHighChromaInputs(
	root,
	packageDirectory,
	runnerPaths,
) {
	const frozen = await collectDropletsInputs(
		root,
		packageDirectory,
		runnerPaths,
		"pipeline",
	);
	const manifest = JSON.parse(
		await readFile(join(root, "fixture-source.json"), "utf8"),
	);
	for (const path of highChromaFixtureNames) {
		const matches = manifest.files.filter((file) => file.path === path);
		assert.equal(
			matches.length,
			1,
			`Missing or duplicate high-chroma source ${path}`,
		);
		assertContained(root, await realpath(join(root, path)));
		assert.equal(
			sha256(await readFile(join(root, path))),
			matches[0].sha256,
			path,
		);
		frozen.inputs.push(matches[0]);
	}
	for (const [name, expected] of Object.entries(frozenDropletsReferences))
		assert.equal(
			sha256(await readFile(join(root, "script/fixtures", name))),
			expected,
			`Original reference changed: ${name}`,
		);
	assert(
		frozen.inputs.some((file) =>
			file.path.endsWith("services/renderer/export-video-chroma.ts"),
		),
		"Snapshot lacks production high-chroma capability implementation",
	);
	return frozen;
}
