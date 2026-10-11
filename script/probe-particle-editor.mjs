import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	copyProject,
	hash,
	nativeCommand,
	plain,
	readJson,
	startPrivateHost,
	treeManifest,
	writeJson,
} from "./particle-c4-export-support.mjs";
import { buildParticleEditor } from "./fixtures/particle-editor-build.mjs";
import { scanParticleCredentials } from "./fixtures/particle-editor-credentials.mjs";
import { particleEditorContract } from "./fixtures/particle-editor-contract.mjs";
import { assertParticleAuthorityRuntime } from "./fixtures/particle-editor-export-authority.mjs";
import {
	prepareParticleEditorLaunch,
	rememberParticleLauncherSources,
} from "./fixtures/particle-editor-launcher-preflight.mjs";
import { runParticleEditorBrowserSession } from "./fixtures/particle-editor-launcher-browser-session.mjs";
import { finishParticleEditorHandoff } from "./fixtures/particle-editor-launcher-handoff.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { options, authority, baseline, root, authorityContextPath, env } =
	await prepareParticleEditorLaunch({ args: process.argv.slice(2) });
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
async function privateReadinessFiles() {
	const files = [];
	for (const name of [
		"host-ready.private.json",
		"host-ready.pending-private.json",
		"host-reopened.private.json",
	]) {
		const path = join(root, name);
		try {
			await plain(path, false);
			files.push(name);
			const descriptor = await readJson(path);
			if (typeof descriptor.token === "string" && descriptor.token)
				secrets.add(descriptor.token);
			if (typeof descriptor.editorUrl === "string" && descriptor.editorUrl)
				secrets.add(descriptor.editorUrl);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	return files;
}
const session = {};
let host,
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
	await rememberParticleLauncherSources({ repo, sources });
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
		baseline
			? baseline.metadata.project.files.find(
					(file) => file.path === "project.json",
				).sha256
			: particleEditorContract.initialProjectSha256,
		"Only the retained C4 revision-2 project is accepted",
	);
	if (baseline)
		assert.deepEqual(
			copyManifest.files.map(({ path, bytes, sha256 }) => ({
				path,
				byteLength: bytes,
				sha256,
			})),
			baseline.metadata.project.files,
		);
	await writeJson(join(root, "project-copy-manifest.json"), {
		sourceProject: options["source-project"],
		exactByteCopy: true,
		...copyManifest,
	});
	const bunVersion = (
		await nativeCommand(options.bun, ["--version"], root, "bun-version")
	).output.trim();
	if (authority)
		assertParticleAuthorityRuntime({
			authority,
			name: "bun",
			executable: options.bun,
			version: bunVersion,
		});
	else assert.equal(bunVersion, "1.2.18");
	evidence.build = await buildParticleEditor({
		repo,
		root,
		options,
		sources,
		authority,
	});
	if (options.mode === "run") {
		host = startPrivateHost({
			executable: options.bun,
			args: [
				join(root, "host.mjs"),
				root,
				options.toolchain,
				options.chromium,
				...(authority ? [authorityContextPath] : []),
			],
			cwd: repo,
			env,
			root,
		});
		const ready = await host.ready();
		secrets.add(ready.token);
		secrets.add(ready.editorUrl);
		await runParticleEditorBrowserSession({
			ready,
			options,
			root,
			env,
			evidence,
			authority,
			redact,
			session,
		});
	}
} catch (error) {
	failure = error;
	evidence.primaryFailure = {
		error: redact(error),
		stack: redact(error?.stack),
	};
} finally {
	const cleanup = [];
	if (authority && session.browserPage) {
		try {
			const observation = await session.browserPage.evaluate(() =>
				globalThis.__particleAuthorityWasmObservation.snapshot(),
			);
			await writeJson(join(root, "particle-browser-authority-final.json"), {
				...observation,
				diagnosticOnly: Boolean(failure) || !observation.actualBytesVerified,
			});
			if (!failure) assert.equal(observation.actualBytesVerified, true);
		} catch (error) {
			cleanup.push(error);
		}
	}
	try {
		if (session.browser) {
			await session.browser.close();
			browserClosed = !session.browser.isConnected();
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
		if (authority) await authority.assertUnchanged();
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
			const privateFiles = await privateReadinessFiles();
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
await finishParticleEditorHandoff({
	options,
	root,
	evidence,
	authority,
	baseline,
	secrets,
});
