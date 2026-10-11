import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";
import { readParticleAuthoredRecipe } from "./particle-authority-authored-recipe.mjs";
import { parseParticleAuthorityPrepareOptions } from "./particle-authority-prepare-contract.mjs";

const originalCreator = process.env.ROCUT_CPU_CREATOR_ROOT;
assert.ok(originalCreator, "Explicit read-only original Creator root required");
const relative = "resources/agent/skills/html-video/assets/rocut-stylized";
const independentPins = [
	[
		"particle-scene.ts",
		3948,
		"706c4074a25268587dcc861b4e04cc1e60f26159c540cced567141f4eb2c3488",
	],
	[
		"particle-object.mjs",
		1835,
		"0809f6ceab847dcf1e51b4c7212c81b8c449e11ac19a15d1bed4b432cfd75b80",
	],
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "particle-recipe-cpu-")),
		creator = join(root, "creator"),
		directory = join(creator, relative),
		output = join(root, "must-not-be-created");
	await mkdir(directory, { recursive: true });
	for (const [name, length, expected] of independentPins) {
		const original = await readFile(join(originalCreator, relative, name)),
			text = new TextDecoder("utf-8", { fatal: true }).decode(original),
			bytes = Buffer.from(text.replace(/\r\n/g, "\n"));
		// Reconstruction is CPU-fixture-only and admitted by independent raw pins.
		assert.equal(digest(bytes), expected);
		assert.equal(bytes.length, length);
		await writeFile(join(directory, name), bytes, { flag: "wx" });
	}
	const args = [
		"artifacts-root",
		"creator-root",
		"authority-receipt",
		"bun",
		"wasm-sync",
		"sampler-dir",
		"toolchain",
		"chromium",
		"ffmpeg",
		"ffprobe",
	].flatMap((name) => [
		"--" + name,
		name === "creator-root" ? creator : output,
	]);
	args.push("--authority", "new-084cf-20261011");
	return { root, creator, directory, output, args };
}

test("independent raw recipe pins admit only exact reconstructed bytes", async () => {
	const f = await fixture(),
		options = parseParticleAuthorityPrepareOptions(f.args);
	assert.equal(options.authoredRecipe.schema, "particle-authored-recipe/v1");
	assert.deepEqual(
		options.authoredRecipe.files.map(({ name, byteLength, sha256 }) => [
			name,
			byteLength,
			sha256,
		]),
		independentPins,
	);
	assert.equal(
		options.authoredRecipe.sourceReceipt.sha256,
		"78749b7c402a2e564662b2af0ce6caf556d5041e5be66566d83926b5d98455b6",
	);
	assert.equal(
		options.authoredRecipe.referencedRunArtifactsAuthenticated,
		false,
	);
	assert.equal(existsSync(f.output), false);
	for (const flag of [
		"expected-sha",
		"expected-author-sha",
		"expected-template-sha",
	])
		assert.throws(
			() =>
				parseParticleAuthorityPrepareOptions([
					...f.args,
					"--" + flag,
					"a".repeat(64),
				]),
			/Unknown/,
		);
});

for (const name of ["particle-scene.ts", "particle-object.mjs"])
	test("changed " + name + " rejects before output creation", async () => {
		const f = await fixture(),
			path = join(f.directory, name);
		await writeFile(
			path,
			Buffer.concat([await readFile(path), Buffer.from("\n")]),
		);
		assert.throws(
			() => parseParticleAuthorityPrepareOptions(f.args),
			(error) =>
				error.message.includes("Creator recipe raw SHA mismatch: " + name),
		);
		assert.equal(existsSync(f.output), false);
	});

test("CRLF recipe is not silently normalized by raw guard", async () => {
	const f = await fixture();
	for (const [name] of independentPins) {
		const path = join(f.directory, name),
			text = await readFile(path, "utf8");
		await writeFile(path, text.replace(/\n/g, "\r\n"), "utf8");
	}
	assert.throws(
		() => readParticleAuthoredRecipe(f.creator),
		/raw SHA mismatch/,
	);
	assert.equal(existsSync(f.output), false);
});

async function isolatedBuild(counters) {
	const source = await readFile(
			new URL("./particle-authority-prepare-build.mjs", import.meta.url),
			"utf8",
		),
		module = new SourceTextModule(source);
	await module.link(async (specifier) => {
		let exports;
		if (specifier.startsWith("node:")) exports = await import(specifier);
		else if (specifier === "esbuild")
			exports = {
				build() {
					counters.build++;
					throw Error("Unexpected build");
				},
			};
		else if (specifier.endsWith("authored-recipe.mjs"))
			exports = { readParticleAuthoredRecipe };
		else if (specifier.endsWith("authority-stage.mjs"))
			exports = {
				stageParticleAuthority() {
					counters.stage++;
					throw Error("Unexpected stage");
				},
			};
		else if (specifier.endsWith("compile-context.mjs"))
			exports = {
				writeParticleCompileBootstrap() {
					counters.bootstrap++;
				},
			};
		else
			exports = {
				hash: digest,
				plain() {
					counters.plain++;
				},
				writeJson() {
					counters.write++;
				},
			};
		const linked = new SyntheticModule(Object.keys(exports), function () {
			for (const [name, value] of Object.entries(exports))
				this.setExport(name, value);
		});
		return linked;
	});
	await module.evaluate();
	return module.namespace.prepareParticleAuthorityCompile;
}

for (const name of ["particle-scene.ts", "particle-object.mjs"])
	test(
		"parse-to-copy drift of " + name + " rejects before staging/building",
		async () => {
			const f = await fixture(),
				options = parseParticleAuthorityPrepareOptions(f.args),
				counters = { build: 0, stage: 0, bootstrap: 0, plain: 0, write: 0 },
				prepare = await isolatedBuild(counters),
				path = join(f.directory, name);
			await writeFile(
				path,
				Buffer.concat([await readFile(path), Buffer.from("\n")]),
			);
			await assert.rejects(
				prepare({
					repo: f.root,
					root: f.output,
					options,
					authority: {},
					sources: new Map(),
				}),
				(error) =>
					error.message.includes("Creator recipe raw SHA mismatch: " + name),
			);
			assert.deepEqual(counters, {
				build: 0,
				stage: 0,
				bootstrap: 0,
				plain: 0,
				write: 0,
			});
			assert.equal(existsSync(f.output), false);
		},
	);
