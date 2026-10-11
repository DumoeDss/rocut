import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function verifyRuntimeCapabilities(context) {
	const resources = context.programmaticResources;
	assert.equal(
		resources.modelInputs.mimeTypes.find(
			(item) => item.mimeType === "image/svg+xml",
		)?.admission,
		"accepted",
	);
	assert.equal(
		resources.buildSourceArchive.restore,
		"programmatic/resources/restore-build-source",
	);
	assert.deepEqual(resources.buildSourceArchive.input, [
		"source",
		"outputDirectory",
	]);
	assert.ok(
		resources.buildSourceArchive.output.includes("metadata/build-source.json"),
	);
	return {
		modelInputs: resources.modelInputs,
		buildSourceArchive: resources.buildSourceArchive,
	};
}

// Builtins only: this file is copied outside the checkout and run by plain Node.
export async function consumePackedRuntime({ root, runtimeDirectory }) {
	assert.equal(process.release.name, "node");
	const expected = JSON.parse(
		readFileSync(join(root, "expected.json"), "utf8"),
	);
	const manifest = JSON.parse(
		readFileSync(join(root, "pack-manifest.json"), "utf8"),
	);
	assert.equal(manifest.wasmPackage.selection, "explicit");
	assert.deepEqual(manifest.wasmPackage.files, expected.packageFiles);
	const binary = join(runtimeDirectory, "opencut_wasm_bg.wasm");
	assert.equal(hash(readFileSync(binary)), expected.binarySha256);
	if (expected.surfaceCore) {
		assert.equal(
			hash(
				readFileSync(
					join(runtimeDirectory, "surface", expected.surfaceCore.path),
				),
			),
			expected.binarySha256,
		);
		assert.equal(expected.surfaceCore.sha256, expected.binarySha256);
		assert.equal(manifest.surface.copied, true);
	}
	const sidecars = [];
	const descriptor = {
		id: "packed-svg-probe",
		kind: "model",
		mimeType: "image/svg+xml",
		byteLength: 1,
		sha256: "0".repeat(64),
		attachmentKey: "programmatic-sha256-" + "0".repeat(64),
	};
	for (const name of ["liquid-object-wasm.mjs", "particle-sampler-wasm.mjs"]) {
		const file = join(runtimeDirectory, name),
			text = readFileSync(file, "utf8");
		assert.match(
			text,
			/new URL\(["']\.\/opencut_wasm_bg\.wasm["'],\s*import\.meta\.url\)/,
		);
		const module = await import(pathToFileURL(file).href);
		assert.deepEqual(
			JSON.parse(
				module.validateProgrammaticResourcesJson(JSON.stringify([descriptor])),
			),
			[],
		);
		sidecars.push({
			name,
			sha256: hash(readFileSync(file)),
			svgAdmission: "accepted",
			fixedWasmSibling: true,
		});
	}
	assert.equal(
		sidecars[0].sha256,
		sidecars[1].sha256,
		"Both fixed WASM modules must bundle the same selected sync/glue closure",
	);
	for (const worker of expected.workers)
		assert.equal(
			hash(readFileSync(join(runtimeDirectory, worker.name))),
			worker.sha256,
		);
	const mainLoaders = manifest.wasmSibling.referencingChunks
		.filter((name) => !sidecars.some((sidecar) => sidecar.name === name))
		.filter((name) =>
			/new URL\(["']\.\/opencut_wasm_bg\.wasm["'],\s*import\.meta\.url\)/.test(
				readFileSync(join(runtimeDirectory, name), "utf8"),
			),
		);
	assert.ok(
		mainLoaders.length > 0,
		"The production main closure must contain the selected fixed sibling loader",
	);
	const project = join(root, "private-project"),
		registry = join(root, "private-registry");
	mkdirSync(project);
	mkdirSync(registry);
	const env = {
		...process.env,
		ROCUT_HTML_BROWSER_PATH: "",
		ROCUT_ENGINE_TOOLCHAIN_DIR: "",
		ELFTIA_HTML_FRAME_CONNECTION_FILE: join(
			root,
			"private-frame-connection.json",
		),
	};
	const entry = join(runtimeDirectory, "rocut.mjs"),
		args = ["--project", project, "--targets-root", registry];
	const run = (command) => {
		const result = spawnSync(process.execPath, [entry, ...command, ...args], {
			cwd: root,
			env,
			encoding: "utf8",
			timeout: 15000,
			maxBuffer: 4 * 1024 * 1024,
		});
		assert.equal(result.status, 0, result.stderr.slice(0, 1000));
		return result.stdout;
	};
	assert.match(run(["--help"]), /programmatic source-restore <spec\.json>/);
	const host = spawn(
		process.execPath,
		[
			entry,
			"host",
			"start",
			project,
			"--port",
			"0",
			"--targets-root",
			registry,
		],
		{ cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
	);
	let target;
	try {
		await new Promise((accept, reject) => {
			let output = "",
				errors = "";
			const timer = setTimeout(
				() => reject(Error("Private runtime Host startup timed out")),
				15000,
			);
			host.stderr.on("data", (chunk) => {
				errors = (errors + chunk).slice(-2000);
			});
			host.once("exit", (code) => {
				clearTimeout(timer);
				reject(Error(`Private runtime Host exited ${code}: ${errors}`));
			});
			host.stdout.on("data", (chunk) => {
				output = (output + chunk).slice(-10000);
				const match = output.match(/^target (\S+)$/m);
				if (match && /^pid \d+$/m.test(output)) {
					target = match[1];
					clearTimeout(timer);
					accept();
				}
			});
		});
		const context = JSON.parse(run(["capabilities", "--target", target]));
		const capability = verifyRuntimeCapabilities(context);
		const invalidSpec = join(root, "source-restore-invalid.json");
		writeFileSync(invalidSpec, "{}", { flag: "wx" });
		const invalid = spawnSync(
			process.execPath,
			[
				entry,
				"programmatic",
				"source-restore",
				invalidSpec,
				"--target",
				target,
				...args,
			],
			{ cwd: root, env, encoding: "utf8", timeout: 15000 },
		);
		assert.notEqual(invalid.status, 0);
		assert.match(
			invalid.stderr,
			/Build source restore requires complete source and absolute outputDirectory/,
		);
		assert.equal(
			JSON.parse(run(["capabilities", "--target", target])).revision,
			context.revision,
		);
		return {
			status: "pass",
			runtime: process.version,
			checkoutExternal: true,
			actualCliCapabilities: true,
			sourceRestoreHelpAndRoute: true,
			invalidRestoreRejectedWithoutRevisionChange: true,
			wasmBinarySha256: expected.binarySha256,
			mainLoaders,
			...(expected.surfaceCore
				? {
						surfaceCore: expected.surfaceCore,
						surfaceCoreMatchesSelected: true,
					}
				: {}),
			sidecars,
			workers: expected.workers,
			...capability,
		};
	} finally {
		if (host.exitCode === null) {
			const closed = new Promise((accept) => host.once("exit", accept));
			host.kill("SIGTERM");
			let timer;
			await Promise.race([
				closed,
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(Error("Owned Host termination timed out")),
						5000,
					);
				}),
			]).finally(() => clearTimeout(timer));
		}
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const root = resolve(process.argv[2]),
		runtimeDirectory = join(root, "runtime");
	const evidence = await consumePackedRuntime({ root, runtimeDirectory });
	writeFileSync(
		join(root, "consumption.json"),
		JSON.stringify(evidence, null, 2),
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			status: evidence.status,
			runtime: evidence.runtime,
			evidence: join(root, "consumption.json"),
		}),
	);
}
