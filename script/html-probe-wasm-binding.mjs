import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync, lstatSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export const HTML_PRIVATE_WASM_ID = "rocut-html-private-wasm";
const virtualId = "\0" + HTML_PRIVATE_WASM_ID;

export function resolveHtmlProbeArtifactDirectory(directory) {
	if (directory === undefined) return undefined;
	assert.ok(
		typeof directory === "string" && isAbsolute(directory),
		"ROCUT_PROBE_ARTIFACTS must be an absolute ordinary directory",
	);
	const stats = lstatSync(directory);
	assert.ok(
		stats.isDirectory() && !stats.isSymbolicLink(),
		"ROCUT_PROBE_ARTIFACTS must be an ordinary directory",
	);
	return directory;
}

export function snapshotHtmlProbeSources(root, paths) {
	return paths.map((path) => {
		const bytes = readFileSync(join(root, path));
		return {
			path,
			byteLength: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	});
}

export async function saveHtmlProbeEvidence({
	directory,
	result,
	binding,
	browser,
	frameBackend,
	root,
	sourceInputs,
}) {
	resolveHtmlProbeArtifactDirectory(directory);
	assert.equal(
		result.passed,
		true,
		"Cannot save unsuccessful HTML probe as success evidence",
	);
	assert.deepEqual(
		snapshotHtmlProbeSources(
			root,
			sourceInputs.map((input) => input.path),
		),
		sourceInputs,
		"HTML probe source inputs changed during this run",
	);
	if (binding) assertHtmlProbeWasmIdentity(binding, result.wasmIdentity);
	const evidence = {
		...result,
		version: 1,
		browser,
		frameBackend,
		electronTested: false,
		wasmBinding: binding ? "explicit-private" : "legacy-shared",
		sourceInputs,
		limitations: [
			"Native resource/font/seek/cancel and short SceneExporter checks only; not full ecosystem or installed Electron acceptance.",
			"Source inputs identify probe entries, not the complete dependency graph; production freeze and terminal exit must be checked separately.",
		],
	};
	await writeFile(
		join(directory, "evidence.json"),
		JSON.stringify(evidence, null, 2) + "\n",
		{ flag: "wx" },
	);
}

/** Undefined alone means legacy shared mode; an explicit bad value never falls back. */
export function resolveHtmlProbeWasmBinding(directory) {
	if (directory === undefined) return undefined;
	assert.ok(
		typeof directory === "string" && isAbsolute(directory),
		"ROCUT_TEST_WASM_DIRECTORY must be an absolute complete web-target WASM directory",
	);
	const resolved = realpathSync(directory);
	assert.ok(
		statSync(resolved).isDirectory(),
		"Private WASM path is not a directory",
	);
	const files = [
		"opencut_wasm.js",
		"opencut_wasm_bg.wasm",
		"opencut_wasm.d.ts",
	].map((name) => {
		const path = join(resolved, name);
		assert.ok(statSync(path).isFile(), `Private WASM missing file: ${name}`);
		const bytes = readFileSync(path);
		assert.ok(bytes.length > 0, `Private WASM empty file: ${name}`);
		if (name.endsWith(".wasm"))
			assert.deepEqual(
				[...bytes.subarray(0, 8)],
				[0, 97, 115, 109, 1, 0, 0, 0],
				"Private WASM invalid binary header",
			);
		return {
			name,
			byteLength: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	});
	return {
		directory: resolved,
		entry: join(resolved, "opencut_wasm.js").replaceAll("\\", "/"),
		identity: { directory: resolved, files },
	};
}

export function assertHtmlProbeWasmIdentity(binding, observed) {
	assert.deepEqual(
		observed,
		binding.identity,
		"HTML probe WASM identity differs from this run",
	);
	assert.deepEqual(
		resolveHtmlProbeWasmBinding(binding.directory).identity,
		binding.identity,
		"Private WASM changed during HTML probe",
	);
}

/** Initialize the same web-target binary in the browser, and stamp only after
 * hashing the bytes actually fetched. No shared dependency exports are mixed in. */
export function createHtmlProbeWasmPlugin(binding) {
	const wasmSha = binding.identity.files.find((file) =>
		file.name.endsWith(".wasm"),
	).sha256;
	const binaryPath = join(binding.directory, "opencut_wasm_bg.wasm");
	const rawBinaryUrl = "/@fs/" + binaryPath.replaceAll("\\", "/");
	return {
		name: "html-probe-private-wasm",
		enforce: "pre",
		configureServer(server) {
			// Vite's ?url module resolves on Windows, but its generic raw @fs
			// middleware can 404 the same outside-workspace drive-qualified file.
			// Serve only this run's exact pinned binary, not arbitrary filesystem paths.
			server.middlewares.use((request, response, next) => {
				try {
					if (decodeURI(request.url ?? "") !== rawBinaryUrl) return next();
					assertHtmlProbeWasmIdentity(binding, binding.identity);
					const bytes = readFileSync(binaryPath);
					assert.equal(
						createHash("sha256").update(bytes).digest("hex"),
						wasmSha,
					);
					response.statusCode = 200;
					response.setHeader("Content-Type", "application/wasm");
					response.setHeader("Content-Length", bytes.length);
					response.setHeader("Cache-Control", "no-store");
					response.end(bytes);
				} catch (error) {
					next(error);
				}
			});
		},
		resolveId(id) {
			if (id === HTML_PRIVATE_WASM_ID) return virtualId;
		},
		load(id) {
			if (id !== virtualId) return;
			assertHtmlProbeWasmIdentity(binding, binding.identity);
			return `import init from ${JSON.stringify(binding.entry)};
import wasmUrl from ${JSON.stringify(join(binding.directory, "opencut_wasm_bg.wasm").replaceAll("\\", "/") + "?url")};
const response = await fetch(wasmUrl);
if (!response.ok) throw Error("Private WASM fetch failed: " + response.status);
const bytes = await response.arrayBuffer();
const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
if (hash !== ${JSON.stringify(wasmSha)}) throw Error("Served private WASM differs from this run");
await init({ module_or_path: bytes });
globalThis.__htmlProbeWasmIdentity = ${JSON.stringify(binding.identity)};
export * from ${JSON.stringify(binding.entry)};`;
		},
	};
}
