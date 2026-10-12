import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Builtins-only consumer of the actual packed CLI, not source service imports. */
export async function packedBuildSourceRestore({
	runtimeDirectory,
	toolchainDirectory,
}) {
	assert.ok(isAbsolute(runtimeDirectory) && isAbsolute(toolchainDirectory));
	const root = await mkdtemp("C:/tmps/rocut-packed-source-restore-");
	const project = join(root, "project"),
		registry = join(root, "registry");
	const author = join(root, "author"),
		entry = join(runtimeDirectory, "rocut.mjs");
	const binarySha256 = digest(
		await readFile(join(runtimeDirectory, "opencut_wasm_bg.wasm")),
	);
	assert.equal(
		binarySha256,
		"748c4ff5780b13a95816c6ef7ae36533b807e39952ccd4a108baa29308272363",
	);
	for (const directory of [project, registry, author, join(author, "assets")])
		await mkdir(directory);
	const bodies = {
		"index.html": Buffer.from(
			`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="empty.css"></head><body><div id="root" data-composition-id="root" data-start="0" data-duration="1" data-width="64" data-height="64">作者 archive</div></body></html>`,
		),
		"empty.css": Buffer.alloc(0),
		"notes.txt": Buffer.from("完整作者归档\n"),
		"assets/raw.bin": Buffer.from([0, 255, 17, 128, 1]),
	};
	for (const [name, bytes] of Object.entries(bodies))
		await writeFile(join(author, name), bytes, { flag: "wx" });
	const env = {
		...process.env,
		TEMP: root,
		TMP: root,
		ROCUT_ENGINE_TOOLCHAIN_DIR: toolchainDirectory,
		ROCUT_HTML_BROWSER_PATH: "",
		ELFTIA_HTML_FRAME_CONNECTION_FILE: join(
			root,
			"no-electron-connection.json",
		),
	};
	let target;
	const run = (command, expectedStatus = 0) => {
		const result = spawnSync(
			process.execPath,
			[
				entry,
				...command,
				"--target",
				target,
				"--project",
				project,
				"--targets-root",
				registry,
			],
			{
				cwd: root,
				env,
				encoding: "utf8",
				timeout: 65000,
				maxBuffer: 4 * 1024 * 1024,
				windowsHide: true,
			},
		);
		assert.equal(result.status, expectedStatus, result.stderr.slice(-2000));
		return result;
	};
	const jsonFile = async (name, input) => {
		const path = join(root, name);
		await writeFile(path, JSON.stringify(input), { flag: "wx" });
		return path;
	};
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
		{
			cwd: root,
			env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		},
	);
	let hostClosed = false,
		exitCode;
	try {
		await new Promise((accept, reject) => {
			let output = "",
				errors = "";
			const timer = setTimeout(
				() => reject(Error("Packed Host startup timed out")),
				15000,
			);
			host.stderr.on("data", (bytes) => {
				errors = (errors + bytes).slice(-2000);
			});
			host.once("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
			host.once("exit", (code) => {
				clearTimeout(timer);
				reject(Error(`Packed Host exited ${code}: ${errors}`));
			});
			host.stdout.on("data", (bytes) => {
				output = (output + bytes).slice(-10000);
				const match = output.match(/^target (\S+)$/m);
				if (match && /^pid \d+$/m.test(output)) {
					target = match[1];
					clearTimeout(timer);
					accept();
				}
			});
		});
		const before = JSON.parse(run(["capabilities"]).stdout);
		assert.equal(before.programmaticBuilds.configured, true);
		const specFile = await jsonFile("compile.json", {
			version: 1,
			engine: "hyperframes",
			sourceDirectory: author,
			entryFile: "index.html",
			files: Object.keys(bodies),
			width: 64,
			height: 64,
			frameRate: { numerator: 30, denominator: 1 },
			durationFrames: 30,
			seed: 1,
		});
		const compiled = JSON.parse(
			run(["programmatic", "compile", specFile]).stdout,
		);
		assert.equal(compiled.source.build.engine, "hyperframes");
		assert.equal(
			compiled.source.build.inputs.length,
			Object.keys(bodies).length,
		);
		await rename(author, join(root, "author-unavailable"));
		const compiledContext = JSON.parse(run(["capabilities"]).stdout);
		assert.equal(compiledContext.revision, before.revision);
		const restoreSpec = await jsonFile("restore.json", {
			source: compiled.source,
			outputDirectory: join(root, "restored"),
		});
		const restored = JSON.parse(
			run(["programmatic", "source-restore", restoreSpec]).stdout,
		);
		assert.equal(restored.status, "complete");
		assert.equal(restored.incomplete, false);
		for (const [name, expected] of Object.entries(bodies))
			assert.deepEqual(
				await readFile(join(restored.sourceDirectory, name)),
				expected,
			);
		const metadata = JSON.parse(
			await readFile(restored.sourceMetadataPath, "utf8"),
		);
		assert.deepEqual(metadata.source, compiled.source);
		for (const item of metadata.fileMap) {
			const bytes = await readFile(join(restored.directory, item.path));
			assert.equal(bytes.length, item.resource.byteLength);
			assert.equal(digest(bytes), item.resource.sha256);
		}
		assert.equal(
			JSON.parse(run(["capabilities"]).stdout).revision,
			before.revision,
		);
		const denied = run(["programmatic", "source-restore", restoreSpec], 1);
		assert.match(denied.stderr, /exist|directory/i);
		for (const [name, expected] of Object.entries(bodies))
			assert.deepEqual(
				await readFile(join(restored.sourceDirectory, name)),
				expected,
			);
		const receipt = {
			status: "pass",
			runtime: process.version,
			root,
			runtimeDirectory,
			binarySha256,
			actualPackedCompile: true,
			sourceRestoreComplete: true,
			authorUnavailable: true,
			declaredSourceFiles: Object.keys(bodies),
			restoredFileMapCount: metadata.fileMap.length,
			allRestoredBytesAndHashesMatch: true,
			revisionUnchanged: true,
			existingOutputRefusedWithoutOverwrite: true,
			noGpuOrAuthorRuntimeExecution: true,
		};
		await writeFile(
			join(root, "receipt.json"),
			JSON.stringify(receipt, null, 2),
			{ flag: "wx" },
		);
		return receipt;
	} catch (error) {
		await writeFile(
			join(root, "failure.json"),
			JSON.stringify(
				{
					status: "fail",
					runtime: process.version,
					runtimeDirectory,
					binarySha256,
					error: String(error),
					stack: error.stack,
				},
				null,
				2,
			),
			{ flag: "wx" },
		);
		throw Error(
			`Packed source restore failed; retained ${root}: ${String(error)}`,
		);
	} finally {
		if (host.exitCode === null && host.signalCode === null) {
			let timer;
			const closed = new Promise((accept) =>
				host.once("exit", (code) => {
					exitCode = code;
					hostClosed = true;
					accept();
				}),
			);
			host.kill("SIGTERM");
			await Promise.race([
				closed,
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(Error("Owned packed Host close timed out")),
						5000,
					);
				}),
			]).finally(() => clearTimeout(timer));
		} else {
			hostClosed = true;
			exitCode = host.exitCode;
		}
		await writeFile(
			join(root, "cleanup.json"),
			JSON.stringify({
				ownedHostExitObserved: hostClosed,
				exitCode,
				signalCode: host.signalCode,
			}),
			{ flag: "wx" },
		);
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const [runtimeDirectory, toolchainDirectory] = process.argv.slice(2);
	const receipt = await packedBuildSourceRestore({
		runtimeDirectory,
		toolchainDirectory,
	});
	console.log(
		JSON.stringify({
			status: receipt.status,
			evidence: join(receipt.root, "receipt.json"),
		}),
	);
}
