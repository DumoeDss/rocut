import assert from "node:assert/strict";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser-probe-toolchain.mjs";
import {
	copyProject,
	hash,
	inside,
	nativeCommand,
	plain,
	readJson,
	startPrivateHost,
	treeManifest,
	writeJson,
} from "./particle-c4-export-support.mjs";
import {
	EDITOR_EXPORT_CONTRACT,
	loadEditorExportHandoff,
} from "./fixtures/particle-editor-export-contract.mjs";
import { buildEditorExport } from "./fixtures/particle-editor-export-build.mjs";
import { verifyEditorExport } from "./fixtures/particle-editor-export-verify.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const required = [
	"artifacts-root",
	"handoff",
	"bun",
	"wasm-sync",
	"sampler-dir",
	"toolchain",
	"chromium",
	"ffmpeg",
	"ffprobe",
];
const options = {},
	args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
	const key = args[index]?.slice(2),
		value = args[index + 1];
	assert.ok(
		args[index]?.startsWith("--") &&
			[...required, "electron-connection-file", "mode"].includes(key) &&
			!options[key] &&
			value,
		"Unknown, duplicate or malformed option",
	);
	assert.ok(
		key === "mode" || isAbsolute(value),
		"Every tool/input/output path must be explicit and absolute",
	);
	options[key] = key === "mode" ? value : resolve(value);
}
assert.ok(
	required.every((key) => options[key]),
	"Missing required options",
);
options.mode ??= "build-only";
assert.ok(["build-only", "run"].includes(options.mode));
assert.ok(inside("C:/tmps", options["artifacts-root"]));
await plain(options["artifacts-root"], true);
for (const key of ["sampler-dir", "toolchain"]) await plain(options[key], true);
for (const key of ["bun", "wasm-sync", "chromium", "ffmpeg", "ffprobe"])
	await plain(options[key], false);
const root = await mkdtemp(
	join(options["artifacts-root"], "particle-editor-export-"),
);
await mkdir(join(root, "temp"));
await mkdir(join(root, "ui"));
console.log(
	JSON.stringify({
		root,
		phase: "final-ui-project-export-preparation",
		mode: options.mode,
	}),
);
const environment = {
	...process.env,
	TEMP: join(root, "temp"),
	TMP: join(root, "temp"),
	TMPDIR: join(root, "temp"),
	ELFTIA_HTML_FRAME_CONNECTION_FILE: options["electron-connection-file"] ?? "",
	ROCUT_HTML_BROWSER_PATH: options["electron-connection-file"]
		? ""
		: options.chromium,
};
const secrets = new Set(),
	sources = new Map(),
	errors = [],
	externalRequests = [];
const redact = (value) => {
	let text = String(value);
	for (const secret of secrets)
		text = text.replaceAll(secret, "[private-capability]");
	return text;
};
const formatError = (error) => ({
	error: redact(error),
	stack: redact(error?.stack),
	...(error instanceof AggregateError
		? { causes: [...error.errors].map(formatError) }
		: {}),
});
let admitted,
	copiedManifest,
	host,
	browser,
	result,
	decoded,
	hostLifecycle,
	browserClosed = false,
	failure;
async function credentialScan() {
	const manifest = await treeManifest(root),
		excluded = [],
		leaks = [];
	let scanned = 0;
	for (const file of manifest.files) {
		if (/(?:\.private|\.pending-private)\.json$/.test(file.path)) {
			excluded.push(file.path);
			continue;
		}
		const bytes = await readFile(join(root, file.path));
		scanned++;
		if (
			[...secrets].some(
				(secret) => secret && bytes.includes(Buffer.from(secret)),
			)
		)
			leaks.push(file.path);
	}
	await writeJson(join(root, "public-credential-scan.json"), {
		scanned,
		excludedPrivateArtifacts: excluded,
		exactInMemoryPatterns: secrets.size,
		leakedPaths: leaks,
		passed: leaks.length === 0,
	});
	assert.deepEqual(leaks, []);
}
try {
	await writeJson(
		join(root, "acceptance-contract.json"),
		EDITOR_EXPORT_CONTRACT,
	);
	admitted = await loadEditorExportHandoff(options.handoff);
	assert.ok(
		!inside(admitted.handoff.project, root),
		"Export artifact root must remain outside the saved UI project",
	);
	if (options["electron-connection-file"]) {
		assert.ok(inside("C:/tmps", options["electron-connection-file"]));
		await plain(options["electron-connection-file"], false);
		const connection = await readJson(options["electron-connection-file"]);
		assert.match(connection.token, /^[a-f0-9]{64}$/);
		secrets.add(connection.token);
		assert.equal(connection.capabilities?.particleCaptureSession?.version, 2);
		assert.equal(
			connection.capabilities?.particleCaptureSession?.protocol,
			"particleSurface-v1",
		);
		assert.equal(
			connection.capabilities?.particleCaptureSession?.path,
			"/v2/particle-capture",
		);
	}
	copiedManifest = await copyProject(
		admitted.handoff.project,
		join(root, "project"),
	);
	assert.deepEqual(copiedManifest, admitted.projectManifest);
	await writeJson(join(root, "project-copy-manifest.json"), {
		sourceProject: admitted.handoff.project,
		...copiedManifest,
		exactByteCopy: true,
	});
	await copyFile(
		options.handoff,
		join(root, "ui-export-handoff.json"),
		constants.COPYFILE_EXCL,
	);
	await writeJson(join(root, "expected-ui-state.json"), admitted.state);
	for (const file of admitted.files) {
		const destination = join(root, "ui", `${file.kind}-${file.frame}.png`);
		await copyFile(file.path, destination, constants.COPYFILE_EXCL);
		assert.equal(hash(await readFile(destination)), file.sha256);
	}
	await writeJson(join(root, "ui-reference-inputs.json"), {
		handoffPath: options.handoff,
		handoffSha256: admitted.handoffSha256,
		stateSha256: admitted.stateSha256,
		files: admitted.files,
		referenceOrigin:
			"Actual final-state editor UI screenshots; no standalone rendering used as reference",
	});
	const version = await nativeCommand(
		options.bun,
		["--version"],
		root,
		"bun-version",
	);
	assert.equal(version.output.trim(), "1.2.18");
	await buildEditorExport({ repo, root, options, sources });
	if (options.mode === "run") {
		host = startPrivateHost({
			executable: options.bun,
			args: [
				join(root, "host.mjs"),
				root,
				options.toolchain,
				options.chromium,
				options.ffmpeg,
				options.ffprobe,
				"particle-model",
				options["electron-connection-file"] ?? "",
			],
			cwd: repo,
			env: environment,
			root,
		});
		const ready = await host.ready();
		secrets.add(ready.token);
		secrets.add(ready.editorUrl);
		const project = await readJson(join(root, "persisted-project.json"));
		assert.deepEqual(
			project,
			admitted.wrapper,
			"Host must reopen the exact saved UI record",
		);
		const origin = new URL(ready.editorUrl).origin;
		browser = await chromium.launch({
			headless: true,
			executablePath: options.chromium,
			env: environment,
			timeout: 60000,
			args: [
				"--enable-unsafe-webgpu",
				"--enable-unsafe-swiftshader",
				"--use-angle=swiftshader",
				"--use-gl=angle",
			],
		});
		const page = await browser.newPage();
		page.on("pageerror", (error) => errors.push(redact(error.message)));
		await page.route("**/*", async (route) => {
			const url = new URL(route.request().url());
			if (/^https?:$/.test(url.protocol) && url.origin !== origin) {
				externalRequests.push(url.origin);
				await route.abort();
			} else await route.continue();
		});
		await page.addInitScript(
			(boot) => {
				globalThis.__particleEditorExportBoot = boot;
			},
			{ project, baseUrl: new URL("api", ready.editorUrl).href },
		);
		await page.goto(
			new URL("script/fixtures/particle-editor-export.html", ready.editorUrl)
				.href,
			{ timeout: 60000, waitUntil: "load" },
		);
		await page.waitForFunction(
			() => globalThis.__particleEditorExportResult,
			undefined,
			{ timeout: 1100000 },
		);
		result = await page.evaluate(() => {
			const output = globalThis.__particleEditorExportResult;
			if (output.error) return output;
			let binary = "";
			for (let i = 0; i < output.video.length; i += 32768)
				binary += String.fromCharCode(...output.video.subarray(i, i + 32768));
			return { ...output, video: btoa(binary) };
		});
		if (result.error) {
			await writeJson(
				join(root, "browser-failure.json"),
				JSON.parse(redact(JSON.stringify(result))),
			);
			throw Error(
				redact(
					result.error +
						"\n" +
						result.stack +
						"\n" +
						JSON.stringify(result.causes),
				),
			);
		}
		assert.deepEqual(errors, []);
		assert.deepEqual(externalRequests, []);
		assert.equal(result.frameCount, 121);
		assert.equal(result.width, 1920);
		assert.equal(result.height, 1080);
		assert.equal(result.mimeType, "video/webm");
		assert.deepEqual(result.range, {
			startTime: 0,
			endTime: 484000,
			duration: 484000,
		});
		const { video, ...summary } = result;
		await writeFile(join(root, "particle.webm"), Buffer.from(video, "base64"), {
			flag: "wx",
		});
		await writeJson(join(root, "browser-export-evidence.json"), {
			...summary,
			browser: browser.version(),
			source:
				"Real saved UI record -> production decodeProject SceneTracks -> buildScene -> SceneExporter; no reconstructed source or replayed edit",
		});
		decoded = await verifyEditorExport({
			root,
			ffmpeg: options.ffmpeg,
			ffprobe: options.ffprobe,
			handoff: admitted.handoff,
		});
	}
} catch (error) {
	failure = error;
} finally {
	const cleanup = [];
	try {
		if (browser) {
			await browser.close();
			browserClosed = !browser.isConnected();
			assert.ok(browserClosed);
		}
	} catch (error) {
		cleanup.push(error);
	}
	try {
		if (host) hostLifecycle = await host.stop();
	} catch (error) {
		cleanup.push(error);
	}
	try {
		if (admitted) {
			assert.equal(
				hash(
					await readFile(
						resolve(
							dirname(options.handoff),
							admitted.handoff.final.fullStateFile,
						),
					),
				),
				admitted.stateSha256,
				"Original complete UI state sidecar changed",
			);
			assert.equal(
				hash(await readFile(options.handoff)),
				admitted.handoffSha256,
				"Original UI handoff changed",
			);
			assert.deepEqual(
				await treeManifest(admitted.handoff.project),
				admitted.projectManifest,
				"Actual UI saved project changed",
			);
			if (copiedManifest)
				assert.deepEqual(
					await treeManifest(join(root, "project")),
					copiedManifest,
					"Private export copy changed",
				);
			for (const file of admitted.files)
				assert.equal(
					hash(await readFile(file.path)),
					file.sha256,
					"Actual UI reference changed",
				);
			await writeJson(join(root, "ui-input-stability.json"), {
				handoffUnchanged: true,
				sourceProjectUnchanged: true,
				exportProjectUnchanged: true,
				actualUiPngsUnchanged: true,
				completeUiStateSidecarUnchanged: true,
			});
		}
	} catch (error) {
		cleanup.push(error);
	}
	const changed = [];
	for (const entry of sources.values()) {
		try {
			if (hash(await readFile(entry.path)) !== entry.sha256)
				changed.push(entry.path);
		} catch {
			changed.push(entry.path);
		}
	}
	await writeJson(join(root, "source-stability.json"), {
		stable: changed.length === 0,
		changed,
	});
	if (changed.length)
		cleanup.push(Error("Export input sources changed during execution"));
	if (cleanup.length)
		failure = new AggregateError(
			failure ? [failure, ...cleanup] : cleanup,
			"Full UI export or cleanup failed",
		);
}
if (failure) {
	await writeJson(join(root, "failure.json"), {
		...formatError(failure),
		errors,
		externalRequests,
		browserClosed,
		hostLifecycle,
		artifactsRetained: true,
	});
	await credentialScan();
	throw Error(redact(failure));
}
const artifacts = [];
for (const name of options.mode === "run"
	? [
			"particle.webm",
			"selected-ui-geometry.rgba",
			"persisted-project.json",
			"decode-ui-verification.json",
		]
	: []) {
	const bytes = await readFile(join(root, name));
	artifacts.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
}
await writeJson(join(root, "evidence.json"), {
	version: 1,
	status: options.mode === "run" ? "passed" : "build-only-passed",
	root,
	mode: options.mode,
	scope: EDITOR_EXPORT_CONTRACT.coverage,
	sourceBackend: options["electron-connection-file"]
		? "elftia-electron-particle-session-v2"
		: "private-chromium",
	actualUiHandoffSha256: admitted.handoffSha256,
	savedProjectSha256: copiedManifest.files.find(
		(file) => file.path === "project.json",
	).sha256,
	revision: admitted.handoff.revision,
	opacity: 0.55,
	width: 1920,
	height: 1080,
	frameCount: options.mode === "run" ? 121 : 0,
	fullSavedTimelineExported: options.mode === "run",
	fullTimelineRange: { startTime: 0, endTime: 484000, duration: 484000 },
	comparedUiFrames: options.mode === "run" ? EDITOR_EXPORT_CONTRACT.frames : [],
	uncomparedPixelFrames: options.mode === "run" ? 115 : 121,
	browserClosed,
	hostLifecycle,
	...(host
		? { hostChildren: await readJson(join(root, "host-children.json")) }
		: {}),
	independentDecode: decoded,
	externalRequests,
	artifacts,
	originalInputsUnmodified: true,
	artifactsRetained: true,
	processBoundary:
		"Observed direct Host/FFmpeg children plus awaited browser.close only; no arbitrary descendant shutdown inference",
});
await credentialScan();
console.log(
	JSON.stringify({
		status: options.mode === "run" ? "passed" : "build-only-passed",
		root,
		evidenceSha256: hash(await readFile(join(root, "evidence.json"))),
	}),
);
