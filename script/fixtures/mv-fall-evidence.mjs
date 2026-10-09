import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

async function identity(path) {
	const stat = await lstat(path);
	assert(
		stat.isFile() && !stat.isSymbolicLink(),
		`Expected ordinary evidence input: ${path}`,
	);
	const body = await readFile(path);
	return {
		byteLength: body.length,
		sha256: createHash("sha256").update(body).digest("hex"),
	};
}
export async function fallWasmIdentity(directory) {
	assert(isAbsolute(directory), "Private Fall WASM path must be absolute");
	const files = {};
	for (const name of [
		"opencut_wasm_bg.wasm",
		"opencut_wasm.js",
		"verification.json",
	])
		files[name] = await identity(join(directory, name));
	const report = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(
			await readFile(join(directory, "verification.json")),
		),
	);
	assert.equal(report.mode, "wasm");
	assert.equal(report.exitCode, 0);
	assert.equal(
		report.wasmSha256,
		files["opencut_wasm_bg.wasm"].sha256,
		"Private build report/WASM identity differs",
	);
	assert.match(report.sourceManifestSha256, /^[a-f0-9]{64}$/);
	return {
		directory,
		files,
		sourceManifestSha256: report.sourceManifestSha256,
		scope:
			"Exact private WASM/glue/build-report files; producer source-manifest digest, not a claim over the current whole workspace",
	};
}
export async function fallServedIdentity(directory) {
	const files = {};
	async function visit(relative) {
		for (const entry of (
			await readdir(join(directory, relative), { withFileTypes: true })
		).sort((a, b) => a.name.localeCompare(b.name))) {
			assert(
				!entry.isSymbolicLink(),
				"Fall served output must not redirect through a symlink",
			);
			const name = relative ? `${relative}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await visit(name);
			else if (entry.isFile())
				files[name] = await identity(join(directory, name));
			else throw Error("Unsupported Fall served output entry");
		}
	}
	await visit("");
	assert(Object.keys(files).length > 0, "Fall served bundle is empty");
	return {
		scope: "Every file in this run's private served web directory",
		files,
	};
}
export function assertFallEvidenceStable(before, after, label) {
	assert.deepEqual(
		after,
		before,
		`${label} changed while Fall acceptance was running`,
	);
}
