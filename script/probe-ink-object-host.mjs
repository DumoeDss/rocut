import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectInkObjectInputs } from "./fixtures/ink-object-host-preflight.mjs";
import { createPrivateEffectInputs } from "./fixtures/private-effect-inputs.mjs";
import { pinInkHostToolchain } from "./fixtures/ink-object-host-toolchain.mjs";

const [pkg, creator, threeToolchain] = process.argv.slice(2);
assert.equal(
	process.argv.length,
	5,
	"Expected explicit private pkg, Creator ink-object.mjs and Three0.185.1 toolchain",
);
for (const path of [pkg, creator, threeToolchain]) assert(isAbsolute(path));
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp("C:/tmps/ink-object-host-");
let report = {
	ok: false,
	root,
	scope:
		"WASM/Host/controlled compile/persistence preparation only; no browser or GPU",
};
try {
	const toolchainBefore = await pinInkHostToolchain(threeToolchain);
	await writeFile(
		join(root, "toolchain-closure.json"),
		JSON.stringify(toolchainBefore, null, 2),
		{ flag: "wx" },
	);
	report.toolchainClosure = {
		path: join(root, "toolchain-closure.json"),
		files: toolchainBefore.files.length,
		bytes: toolchainBefore.bytes,
	};
	const inspected = await inspectInkObjectInputs({
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
			join(dirname(creator), "ink-object-scene.ts"),
		]);
		const entry = join(root, "ink-entry.ts"),
			output = join(root, "ink-host.mjs"),
			files = new Map();
		await writeFile(
			entry,
			`import { startHost } from ${JSON.stringify(join(workspace, "apps/cli/src/host.ts"))};
import { TargetRegistry } from ${JSON.stringify(join(workspace, "apps/cli/src/target-registry.ts"))};
import { runInkObjectHostProbe } from ${JSON.stringify(join(workspace, "script/fixtures/ink-object-host-run.mjs"))};
export default await runInkObjectHostProbe({startHost,TargetRegistry,root:${JSON.stringify(root)},creator:${JSON.stringify(dynamic[0].file.path)},pkg:${JSON.stringify(pkg)},threeToolchain:${JSON.stringify(threeToolchain)}});\n`,
			{ flag: "wx" },
		);
		const result = await Bun.build({
			entrypoints: [entry],
			target: "bun",
			outdir: root,
			naming: "ink-host.mjs",
			plugins: [
				{
					name: "private-ink-host-inputs",
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
		assert.deepEqual(
			await pinInkHostToolchain(threeToolchain),
			toolchainBefore,
			"Actual toolchain closure drift",
		);
		report.toolchainClosure.unchanged = true;
		await verifyWasm();
		report.host = executed.default;
		report.bundleInputs.finalValidation = await inputs.verify([
			...files.values(),
			...dynamic.map((item) => item.file),
		]);
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
