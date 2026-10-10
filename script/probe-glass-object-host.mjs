import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectGlassObjectInputs } from "./fixtures/glass-object-preflight.mjs";
import { createPrivateEffectInputs } from "./fixtures/private-effect-inputs.mjs";

const [pkg, creator, threeToolchain] = process.argv.slice(2);
assert.equal(
	process.argv.length,
	5,
	"Expected explicit private pkg, Creator glass-object.mjs and Three0.185.1 toolchain",
);
for (const path of [pkg, creator, threeToolchain]) assert(isAbsolute(path));
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp("C:/tmps/glass-object-host-");
let report = {
	ok: false,
	root,
	scope:
		"WASM/Host/controlled compile/persistence preparation only; no browser or GPU",
};
try {
	const inspected = await inspectGlassObjectInputs({
		pkg,
		creator,
		threeToolchain,
		workspace,
	});
	report.inputs = inspected;
	if (!inspected.ok) {
		report.status = inspected.status;
		process.exitCode = 2;
	} else {
		assert(
			process.versions.bun,
			"Ready Host probe must run with explicit existing Bun; no tool installation",
		);
		const temporary = join(root, "temp");
		await mkdir(temporary);
		for (const key of ["TMPDIR", "TEMP", "TMP"]) process.env[key] = temporary;
		const inputs = await createPrivateEffectInputs(root);
		const dynamic = await inputs.captureGroup([
			creator,
			join(dirname(creator), "glass-object-scene.ts"),
		]);
		const entry = join(root, "glass-entry.ts"),
			output = join(root, "glass-host.mjs"),
			files = new Map();
		await writeFile(
			entry,
			`import { startHost } from ${JSON.stringify(join(workspace, "apps/cli/src/host.ts"))};
import { TargetRegistry } from ${JSON.stringify(join(workspace, "apps/cli/src/target-registry.ts"))};
import { runGlassObjectHostProbe } from ${JSON.stringify(join(workspace, "script/fixtures/glass-object-host.mjs"))};
export default await runGlassObjectHostProbe({startHost,TargetRegistry,root:${JSON.stringify(root)},creator:${JSON.stringify(dynamic[0].file.path)},pkg:${JSON.stringify(pkg)},threeToolchain:${JSON.stringify(threeToolchain)}});\n`,
			{ flag: "wx" },
		);
		const result = await Bun.build({
			entrypoints: [entry],
			target: "bun",
			outdir: root,
			naming: "glass-host.mjs",
			plugins: [
				{
					name: "private-glass-host-inputs",
					setup(builder) {
						builder.onResolve({ filter: /^opencut-wasm$/ }, () => ({
							path: join(pkg, "opencut_wasm_sync.js"),
							external: true,
						}));
						builder.onLoad(
							{ filter: /./ },
							async ({ path, namespace, loader }) => {
								if (path.startsWith("bun:")) return undefined;
								assert.equal(namespace, "file");
								const captured = await inputs.capture(path, { loader });
								files.set(path, captured.file);
								return { contents: captured.bytes, loader };
							},
						);
					},
				},
			],
		});
		assert(result.success, result.logs.map(String).join("\n"));
		assert.equal(result.outputs.length, 1);
		report.bundleInputs = {
			inputValidation: await inputs.verify([
				...files.values(),
				...dynamic.map((item) => item.file),
			]),
			files: [...files.values()],
			dynamic: dynamic.map((item) => item.file),
			sourceSnapshot: inputs.evidence(),
		};
		const wasmPins = inspected.files.filter(
			(file) => resolve(dirname(file.path)) === resolve(pkg),
		);
		assert.equal(
			wasmPins.length,
			4,
			"Complete explicit private WASM package pins required",
		);
		const verifyWasm = async () => {
			for (const file of wasmPins)
				assert.equal(
					createHash("sha256")
						.update(await readFile(file.path))
						.digest("hex"),
					file.sha256,
					"Private WASM package drift",
				);
		};
		await verifyWasm();
		const executed = await import(pathToFileURL(output).href);
		await verifyWasm();
		report.host = executed.default;
		report.ok = report.host.ok;
		report.status = "completed-host-persistence-no-gpu";
	}
} catch (error) {
	report.status = "failed";
	report.failure = {
		name: error.name,
		message: String(error.message).replace(
			/https?:\/\/[^\s"'<>]+/g,
			"[private URL redacted]",
		),
		inputReceipt: error.receipt ?? null,
	};
	process.exitCode = 1;
} finally {
	await writeFile(
		join(root, "evidence.json"),
		JSON.stringify(report, null, 2),
		{ flag: "wx" },
	);
	console.log(JSON.stringify({ root, ok: report.ok, status: report.status }));
}
