import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	assertParticleSamplerIdentity,
	completeParticleSamplerIdentity,
	particleSamplerSha256,
	snapshotParticleSamplerIdentity,
} from "../programmatic/particle-sampler-identity";
import { captureParticleSamplerSource } from "../programmatic/particle-sampler-identity-source";
import { spawnParticleSamplerProcess } from "../programmatic/particle-sampler-worker-process";
import { bootstrapParticleSamplerProcess } from "../programmatic/particle-sampler-worker-bootstrap";
import { particleTransportPolicyJson } from "./particle-policy-fixture.mjs";

function fixture() {
	const directory = mkdtempSync(
		join(
			process.env.ROCUT_PARTICLE_TEST_ARTIFACT_ROOT ?? tmpdir(),
			"identity-",
		),
	);
	const module = join(directory, "opencut_wasm_sync.js");
	const worker = join(directory, "particle-sampler-worker-entry.mjs");
	writeFileSync(
		module,
		`import { readFileSync } from "node:fs";
import * as glue from "./opencut_wasm_bg.js";
const compiled = new WebAssembly.Module(readFileSync(new URL("./opencut_wasm_bg.wasm", import.meta.url)));
glue.__wbg_set_wasm(new WebAssembly.Instance(compiled, {}).exports);
export {sampleParticleSurfaceJson, particleTransportPolicyJson} from "./opencut_wasm_bg.js";`,
	);
	writeFileSync(
		join(directory, "opencut_wasm_bg.js"),
		`export function __wbg_set_wasm() {}
export function sampleParticleSurfaceJson(value) { return value; }
export function particleTransportPolicyJson() { return ${JSON.stringify(particleTransportPolicyJson())}; }`,
	);
	writeFileSync(
		join(directory, "opencut_wasm_bg.wasm"),
		Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
	);
	writeFileSync(
		worker,
		readFileSync(
			new URL(
				"../programmatic/particle-sampler-worker-entry.mjs",
				import.meta.url,
			),
		),
	);
	const capture = () =>
		captureParticleSamplerSource({
			moduleUrl: pathToFileURL(module).href,
			workerEntryUrl: pathToFileURL(worker).href,
			layout: "source-sync",
		});
	return { directory, module, worker, capture };
}
const hashes = {
	policyHash: particleSamplerSha256("effective"),
	publishedPolicyHash: particleSamplerSha256("published"),
};

test("identity is portable, canonical, strictly validated and deeply frozen", () => {
	const f = fixture();
	const first = completeParticleSamplerIdentity(
		f.capture().identityBase,
		hashes,
	);
	const second = completeParticleSamplerIdentity(
		f.capture().identityBase,
		hashes,
	);
	expect(first).toEqual(second);
	expect(JSON.stringify(first)).not.toContain(f.directory);
	expect(Object.isFrozen(first)).toBe(true);
	expect(Object.isFrozen(first.runtime)).toBe(true);
	expect(Object.isFrozen(first.files)).toBe(true);
	expect(first.files.every(Object.isFrozen)).toBe(true);
	expect(() => assertParticleSamplerIdentity(first, second)).not.toThrow();
	const reordered = Object.fromEntries(Object.entries(first).reverse());
	expect(snapshotParticleSamplerIdentity(reordered)).toEqual(first);
	for (const bad of [
		null,
		{ ...first, unexpected: true },
		{ ...first, executionHash: "0".repeat(64) },
		{ ...first, files: first.files.slice(1) },
		{ ...first, runtime: { ...first.runtime, path: "host" } },
		{ ...first, policyHash: "0".repeat(64) },
		{ ...first, identityHash: "0".repeat(64) },
	])
		expect(() => snapshotParticleSamplerIdentity(bad)).toThrow();
	const narrowed = completeParticleSamplerIdentity(f.capture().identityBase, {
		...hashes,
		policyHash: particleSamplerSha256("narrowed"),
	});
	expect(() => assertParticleSamplerIdentity(first, narrowed)).toThrow(
		"recompile",
	);
});

test("every closure file changes identity even with equal byte length", () => {
	for (const name of [
		"opencut_wasm_sync.js",
		"opencut_wasm_bg.js",
		"opencut_wasm_bg.wasm",
		"particle-sampler-worker-entry.mjs",
	]) {
		const f = fixture();
		const before = f.capture();
		const path = join(f.directory, name);
		const bytes = readFileSync(path);
		// Whitespace change in JS; a changed unused WASM header byte for hashing.
		if (name.endsWith(".wasm")) bytes[7] = 1;
		else {
			const space = bytes.indexOf(32);
			bytes[space] = 9;
		}
		writeFileSync(path, bytes);
		const after = f.capture();
		expect(after.identityBase.closureHash).not.toBe(
			before.identityBase.closureHash,
		);
		expect(() =>
			assertParticleSamplerIdentity(
				completeParticleSamplerIdentity(before.identityBase, hashes),
				completeParticleSamplerIdentity(after.identityBase, hashes),
			),
		).toThrow("recompile");
	}
});

test("unknown module edges, missing exports and nonfixed layouts fail closed", () => {
	for (const addition of [
		'\nimport "./extra.js";',
		'\nexport { unknown } from "./extra.js";',
		'\nconst extra = import("./extra.js");',
		'\nconst extra = readFileSync("other.wasm");',
	]) {
		const f = fixture();
		writeFileSync(f.module, readFileSync(f.module, "utf8") + addition);
		expect(f.capture).toThrow("closure");
	}
	const missing = fixture();
	writeFileSync(
		missing.module,
		readFileSync(missing.module, "utf8").replace(
			"particleTransportPolicyJson",
			"old",
		),
	);
	expect(missing.capture).toThrow("exports");
	const f = fixture();
	expect(() =>
		captureParticleSamplerSource({
			moduleUrl: pathToFileURL(join(f.directory, "page-selected.js")).href,
			workerEntryUrl: pathToFileURL(f.worker).href,
			layout: "source-sync",
		}),
	).toThrow("fixed");
});

test("child executes the captured module, glue, WASM and entry after all files change", async () => {
	const f = fixture();
	const captured = f.capture();
	for (const name of [
		"opencut_wasm_sync.js",
		"opencut_wasm_bg.js",
		"opencut_wasm_bg.wasm",
		"particle-sampler-worker-entry.mjs",
	])
		writeFileSync(
			join(f.directory, name),
			'throw Error("changed after capture")',
		);
	const spawned = spawnParticleSamplerProcess(
		captured.moduleUrl,
		undefined,
		captured,
	);
	let closed = false;
	spawned.child.once("close", () => {
		closed = true;
	});
	const worker = await bootstrapParticleSamplerProcess(spawned, 5000);
	try {
		await worker.ready;
		expect(await worker.sampler("{}", new AbortController().signal)).toBe("{}");
		const identity = completeParticleSamplerIdentity(
			captured.identityBase,
			worker,
		);
		expect(identity.policyHash).toBe(worker.policyHash);
		expect(identity.publishedPolicyHash).toBe(worker.publishedPolicyHash);
	} finally {
		await worker.terminateSampler();
	}
	expect(closed).toBe(true);
});

test("byte-bound missing exports fail and a blocking getter remains killable", async () => {
	for (const mode of ["missing", "blocking"] as const) {
		const f = fixture();
		const gluePath = join(f.directory, "opencut_wasm_bg.js");
		const original = readFileSync(gluePath, "utf8");
		writeFileSync(
			gluePath,
			mode === "missing"
				? original.replace(
						"function particleTransportPolicyJson",
						"function oldPolicy",
					)
				: original.replace(
						`return ${JSON.stringify(particleTransportPolicyJson())};`,
						'process.send({kind:"identity-test-getter-started"}); for (;;) {}',
					),
		);
		const captured = f.capture();
		const spawned = spawnParticleSamplerProcess(
			captured.moduleUrl,
			undefined,
			captured,
		);
		let closed = false;
		let entered = false;
		spawned.child.once("close", () => {
			closed = true;
		});
		spawned.child.on("message", (value: unknown) => {
			if ((value as { kind?: string })?.kind === "identity-test-getter-started")
				entered = true;
		});
		await expect(bootstrapParticleSamplerProcess(spawned, 500)).rejects.toThrow(
			mode === "blocking" ? "timed out" : "initialization failed",
		);
		expect(closed).toBe(true);
		if (mode === "blocking") expect(entered).toBe(true);
	}
});
