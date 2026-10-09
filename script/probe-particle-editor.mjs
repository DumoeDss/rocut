import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
import { poll } from "./fixtures/stylized-fusion-checks.mjs";
import { buildParticleEditor } from "./fixtures/particle-editor-build.mjs";
import { scanParticleCredentials } from "./fixtures/particle-editor-credentials.mjs";
import {
	observeParticleFrames,
	runParticleEditorChecks,
} from "./fixtures/particle-editor-checks.mjs";
import {
	parseParticleEditorOptions,
	particleEditorContract,
} from "./fixtures/particle-editor-contract.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = parseParticleEditorOptions(process.argv.slice(2));
assert.ok(inside("C:/tmps/rocut-stylized-f6XU4z", options["source-project"]));
assert.equal(
	resolve(options["artifacts-root"]).toLowerCase(),
	resolve("C:/tmps/rocut-stylized-f6XU4z").toLowerCase(),
);
for (const key of [
	"artifacts-root",
	"source-project",
	"sampler-dir",
	"toolchain",
])
	await plain(options[key], true);
for (const key of ["bun", "wasm-sync", "chromium"])
	await plain(options[key], false);
const root = await mkdtemp(join(options["artifacts-root"], "particle-editor-"));
await mkdir(join(root, "temp"));
const env = {
	...process.env,
	TEMP: join(root, "temp"),
	TMP: join(root, "temp"),
	TMPDIR: join(root, "temp"),
	ELFTIA_HTML_FRAME_CONNECTION_FILE: "",
	ROCUT_HTML_BROWSER_PATH: options.chromium,
};
const sources = new Map(),
	secrets = new Set();
const evidence = {
	version: 1,
	status: "preparing",
	mode: options.mode,
	root,
	sourceBackend: "private Chromium SwiftShader",
	productionUi: true,
	electronTested: false,
	exportTested: false,
	errors: [],
	httpFailures: [],
	consoleErrors: [],
	externalRequests: [],
};
const redact = (value) => {
	let text = String(value);
	for (const secret of secrets)
		text = text.replaceAll(secret, "[private-capability]");
	return text.replace(/https?:\/\/[^\s"'<>]+/g, "[URL redacted]");
};
let host,
	browser,
	copyManifest,
	failure,
	browserClosed = false;
console.log(
	JSON.stringify({
		phase: "particle-editor-preparation",
		mode: options.mode,
		root,
	}),
);
try {
	await writeJson(
		join(root, "acceptance-contract.json"),
		particleEditorContract,
	);
	copyManifest = await copyProject(
		options["source-project"],
		join(root, "project"),
	);
	assert.equal(
		copyManifest.files.find((entry) => entry.path === "project.json").sha256,
		particleEditorContract.initialProjectSha256,
		"Only the retained C4 revision-2 project is accepted",
	);
	await writeJson(join(root, "project-copy-manifest.json"), {
		sourceProject: options["source-project"],
		exactByteCopy: true,
		...copyManifest,
	});
	assert.equal(
		(
			await nativeCommand(options.bun, ["--version"], root, "bun-version")
		).output.trim(),
		"1.2.18",
	);
	evidence.build = await buildParticleEditor({ repo, root, options, sources });
	if (options.mode === "run") {
		host = startPrivateHost({
			executable: options.bun,
			args: [join(root, "host.mjs"), root, options.toolchain, options.chromium],
			cwd: repo,
			env,
			root,
		});
		const ready = await host.ready();
		secrets.add(ready.token);
		secrets.add(ready.editorUrl);
		const origin = new URL(ready.editorUrl).origin;
		const request = async (route, body) => {
			const response = await fetch(new URL(`api/${route}`, ready.editorUrl), {
				signal: AbortSignal.timeout(15000),
				...(body === undefined
					? {}
					: {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify(body),
						}),
			});
			if (!response.ok)
				throw Error(`Host ${route} returned ${response.status}`);
			return response.json();
		};
		browser = await chromium.launch({
			headless: true,
			executablePath: options.chromium,
			env,
			timeout: 60000,
			args: [
				"--no-proxy-server",
				"--enable-unsafe-webgpu",
				"--enable-unsafe-swiftshader",
				"--use-angle=swiftshader",
				"--use-gl=angle",
			],
		});
		const page = await browser.newPage({
			viewport: { width: 1440, height: 1000 },
			deviceScaleFactor: 1,
		});
		page.on("pageerror", (error) =>
			evidence.errors.push(redact(error.message)),
		);
		page.on("console", (message) => {
			if (message.type() === "error")
				evidence.consoleErrors.push(redact(message.text()));
		});
		page.on("response", (response) => {
			if (response.status() < 400) return;
			const path = new URL(response.url()).pathname;
			if (
				response.status() === 404 &&
				path.endsWith("/api/library/graph-editor-presets/user-presets")
			)
				return;
			evidence.httpFailures.push({
				status: response.status(),
				path: redact(path),
			});
		});
		await page.route("**/*", async (route) => {
			const url = new URL(route.request().url());
			if (/^https?:$/.test(url.protocol) && url.origin !== origin) {
				evidence.externalRequests.push(url.origin);
				await route.abort();
			} else await route.continue();
		});
		const frames = observeParticleFrames(page);
		await page.goto(ready.editorUrl, { waitUntil: "load", timeout: 60000 });
		await page
			.locator(
				'[data-testid="timeline-clip"][data-element-id="particle-model"]',
			)
			.waitFor({ timeout: 60000 });
		await poll(async () => (await request("export")).surfaces === 1);
		await runParticleEditorChecks({ page, root, request, frames, evidence });
		evidence.frameRequests = frames.requests;
		evidence.browser = browser.version();
		assert.deepEqual(evidence.errors, []);
		assert.deepEqual(evidence.httpFailures, []);
		assert.deepEqual(evidence.externalRequests, []);
	}
} catch (error) {
	failure = error;
	evidence.primaryFailure = {
		error: redact(error),
		stack: redact(error?.stack),
	};
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
		if (host) {
			if (failure)
				await writeJson(join(root, "probe-abort.json"), {
					status: "failed",
					reason:
						"Primary probe failure; close Host without claiming final UI state exists",
				});
			evidence.hostLifecycle = await host.stop();
		}
	} catch (error) {
		cleanup.push(error);
	}
	try {
		if (copyManifest) {
			assert.deepEqual(
				await treeManifest(options["source-project"]),
				copyManifest,
				"Original C4 project must remain byte-identical",
			);
			evidence.originalProjectUnmodified = true;
			if (options.mode === "build-only")
				assert.deepEqual(
					await treeManifest(join(root, "project")),
					copyManifest,
				);
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
			stable: !changed.length,
			changed,
		});
		assert.deepEqual(changed, [], "Probe inputs changed during execution");
	} catch (error) {
		cleanup.push(error);
	}
	try {
		if (host) {
			const privateFiles = [];
			for (const name of [
				"host-ready.private.json",
				"host-ready.pending-private.json",
				"host-reopened.private.json",
			]) {
				const path = join(root, name);
				try {
					await plain(path, false);
					privateFiles.push(name);
					const descriptor = await readJson(path);
					if (typeof descriptor.token === "string" && descriptor.token)
						secrets.add(descriptor.token);
					if (typeof descriptor.editorUrl === "string" && descriptor.editorUrl)
						secrets.add(descriptor.editorUrl);
				} catch (error) {
					if (error.code !== "ENOENT") throw error;
				}
			}
			try {
				evidence.credentialAudit = await scanParticleCredentials(
					root,
					secrets,
					privateFiles,
				);
				evidence.preDeletionCredentialAudit = evidence.credentialAudit;
				assert.deepEqual(
					evidence.credentialAudit.leaks,
					[],
					"Exact known credential found outside private descriptors",
				);
			} finally {
				for (const name of privateFiles) await unlink(join(root, name));
				evidence.privateReadinessRemoved = true;
			}
			evidence.credentialAudit.readinessFilesRemovedAfterScan = true;
		}
	} catch (error) {
		cleanup.push(error);
	}
	if (cleanup.length)
		failure = new AggregateError(
			[failure, ...cleanup].filter(Boolean),
			"Particle editor or cleanup failed",
		);
}
evidence.browserClosed = browserClosed;
evidence.parameterUi = particleEditorContract.parameterUi;
evidence.hostParameterRevision = particleEditorContract.hostParameterRevision;
if (failure) {
	evidence.status = "failed";
	evidence.error = redact(failure);
	evidence.causes =
		failure instanceof AggregateError
			? [...failure.errors].map((error) => ({
					error: redact(error),
					stack: redact(error?.stack),
				}))
			: [{ stack: redact(failure?.stack) }];
	await writeJson(join(root, "evidence.json"), evidence);
	throw Error(`Particle editor failed; retained redacted evidence at ${root}`);
}
if (options.mode === "run") {
	evidence.hostChildren = await readJson(join(root, "host-children.json"));
	assert.ok(evidence.hostChildren.allObservedDirectChildrenClosed);
	assert.deepEqual(
		await readJson(join(root, "host-reopened-state.json")),
		await readJson(join(root, "expected-final-state.json")),
	);
	const finalManifest = await treeManifest(join(root, "project"));
	const initialState = await readJson(join(root, "initial-state.json"));
	const finalState = await readJson(join(root, "expected-final-state.json"));
	const originalDisk = await readJson(
		join(options["source-project"], "project.json"),
	);
	const finalDisk = await readJson(join(root, "project/project.json"));
	await writeJson(join(root, "export-handoff.json"), {
		project: join(root, "project"),
		revision: evidence.finalRevision,
		opacity: evidence.finalOpacity,
		exactUiSavedProject: true,
		hostReopened: true,
		previewReferences: evidence.previewReferences,
		baseline: {
			revision: initialState.revision,
			projectSha256: particleEditorContract.initialProjectSha256,
			metadata: originalDisk.record.data.metadata,
			settings: originalDisk.record.data.settings,
			fullStateFile: "initial-state.json",
			fullStateSha256: hash(await readFile(join(root, "initial-state.json"))),
		},
		final: {
			revision: finalState.revision,
			metadata: finalDisk.record.data.metadata,
			settings: finalDisk.record.data.settings,
			fullStateFile: "expected-final-state.json",
			fullStateSha256: hash(
				await readFile(join(root, "expected-final-state.json")),
			),
			sourceSha256: hash(
				JSON.stringify(
					finalState.clips.find(
						(clip) => clip.id === particleEditorContract.clipId,
					).editing.programmatic,
				),
			),
		},
		instruction:
			"Consume this saved project unchanged. Do not rebuild source or replay the UI opacity edit.",
		...finalManifest,
	});
	assert.equal(
		finalManifest.files.find((entry) => entry.path === "project.json").sha256,
		evidence.uiSavedProjectSha256,
	);
	evidence.exportHandoff = join(root, "export-handoff.json");
}
evidence.status = options.mode === "run" ? "passed" : "build-only-passed";
if (secrets.size) {
	const artifactManifest = await treeManifest(root);
	const leaks = [];
	for (const entry of artifactManifest.files) {
		const bytes = await readFile(join(root, entry.path));
		if ([...secrets].some((secret) => bytes.includes(Buffer.from(secret))))
			leaks.push(entry.path);
	}
	assert.deepEqual(
		leaks,
		[],
		"Known private capability found in retained artifacts",
	);
	evidence.credentialAudit = {
		exactKnownHostSecretScan: true,
		filesScanned: artifactManifest.files.length,
		leaks,
		readinessFilesRemoved: true,
		scope:
			"Known current Host token and editor URL; no prior-session credentials used",
	};
}
await writeJson(join(root, "evidence.json"), evidence);
console.log(
	JSON.stringify({
		status: evidence.status,
		root,
		evidenceSha256: hash(await readFile(join(root, "evidence.json"))),
	}),
);
