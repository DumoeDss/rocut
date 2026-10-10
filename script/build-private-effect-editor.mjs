import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./browser-probe-toolchain.mjs";
import { createPrivateEffectInputs } from "./fixtures/private-effect-inputs.mjs";

const [pkg, parent] = process.argv.slice(2);
assert.equal(
	process.argv.length,
	4,
	"Expected <private-pkg> <C:/tmps/artifact-parent>",
);
for (const target of [pkg, parent]) {
	assert(isAbsolute(target));
	const relative = win32.relative("C:/tmps", target);
	assert(!relative.startsWith("..") && !win32.isAbsolute(relative));
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = await mkdtemp(join(parent, "effect-editor-build-"));
const editorDist = join(artifacts, "editor-dist");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = new Map();
const frozen = new Map();
const inputs = await createPrivateEffectInputs(artifacts);
for (const file of [
	fileURLToPath(import.meta.url),
	join(root, "script/browser-probe-toolchain.mjs"),
	join(root, "script/fixtures/private-effect-inputs.mjs"),
	join(root, "apps/vite-example/vite.config.ts"),
	join(root, "apps/vite-example/index.html"),
	join(root, "apps/vite-example/surface-evidence.html"),
	...[
		"opencut_wasm.js",
		"opencut_wasm_bg.js",
		"opencut_wasm_bg.wasm",
		"package.json",
	].map((name) => join(pkg, name)),
]) {
	const privateWasm =
		resolve(file).startsWith(resolve(pkg) + "/") ||
		resolve(file).startsWith(resolve(pkg) + "\\");
	frozen.set(
		file,
		privateWasm
			? await inputs.pinBinary(file)
			: (await inputs.capture(file)).file,
	);
}
const report = {
	ok: false,
	artifacts,
	editorDist,
	pkg,
	startedAt: new Date().toISOString(),
	wasmSha256: frozen.get(join(pkg, "opencut_wasm_bg.wasm")).sha256,
	warnings: [],
	scope:
		"Normal Vite production editor with private WASM alias. Text-module loader returns the same bytes it pins; non-text assets and dynamic dependencies are not claimed as a complete source closure. No shared output or dependency replacement.",
};
console.log(
	JSON.stringify({ phase: "building-private-effect-editor", artifacts }),
);
try {
	await build({
		root: join(root, "apps/vite-example"),
		configFile: join(root, "apps/vite-example/vite.config.ts"),
		cacheDir: join(artifacts, "vite-cache"),
		logLevel: "warn",
		resolve: {
			alias: [
				{ find: /^opencut-wasm$/, replacement: join(pkg, "opencut_wasm.js") },
			],
		},
		plugins: [
			{
				name: "private-editor-text-source-pin",
				enforce: "pre",
				async load(id) {
					if (
						!isAbsolute(id) ||
						id.includes("?") ||
						!/\.(?:[cm]?[jt]sx?|json|css)$/.test(id)
					)
						return null;
					const captured = await inputs.capture(id);
					const file = captured.file;
					if (files.has(id))
						assert.equal(files.get(id).sha256, file.sha256, id);
					files.set(id, file);
					return captured.text();
				},
			},
		],
		build: {
			outDir: editorDist,
			emptyOutDir: false,
			rollupOptions: {
				onwarn(warning, handler) {
					report.warnings.push({
						code: warning.code,
						message: warning.message,
					});
					handler(warning);
				},
			},
		},
	});
	const binaries = (await readdir(join(editorDist, "assets"))).filter(
		(file) => file.startsWith("opencut_wasm_bg-") && file.endsWith(".wasm"),
	);
	assert.equal(binaries.length, 1);
	const binary = join(editorDist, "assets", binaries[0]);
	assert.equal(digest(await readFile(binary)), report.wasmSha256);
	report.emittedWasm = binary;
	report.inputValidation = await inputs.verify([
		...frozen.values(),
		...files.values(),
	]);
	report.inputsUnchanged = true;
	report.ok = true;
} catch (error) {
	report.failure = error.stack ?? String(error);
	if (error.receipt) report.inputValidation = error.receipt;
} finally {
	report.finishedAt = new Date().toISOString();
	report.frozen = [...frozen.values()];
	report.textModules = [...files.values()];
	report.sourceSnapshot = inputs.evidence();
	await writeFile(
		join(artifacts, "build-evidence.json"),
		JSON.stringify(report, null, 2) + "\n",
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			phase: "private-effect-editor-built",
			artifacts,
			editorDist,
			ok: report.ok,
			wasmSha256: report.wasmSha256,
			textModules: files.size,
			warnings: report.warnings.length,
			failure: report.failure,
		}),
	);
}
if (!report.ok) process.exitCode = 1;
