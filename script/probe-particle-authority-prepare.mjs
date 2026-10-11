import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runProbeChild } from "./probe-child-lifecycle.mjs";
import {
	hash,
	inside,
	nativeCommand,
	plain,
	readJson,
	writeJson,
} from "./particle-c4-export-support.mjs";
import {
	admitParticleAuthority,
	assertParticleAuthorityRuntime,
	parseParticleAuthoritySelection,
} from "./fixtures/particle-editor-export-authority.mjs";
import {
	particleAuthorityPaths,
	verifyParticleAuthorityStage,
} from "./fixtures/particle-editor-export-authority-stage.mjs";
import { writeParticleCompileContext } from "./fixtures/particle-authority-compile-context.mjs";
import { parseParticleAuthorityPrepareOptions } from "./fixtures/particle-authority-prepare-contract.mjs";
import { prepareParticleAuthorityCompile } from "./fixtures/particle-authority-prepare-build.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = parseParticleAuthorityPrepareOptions(process.argv.slice(2));
const selection = parseParticleAuthoritySelection(options),
	paths = particleAuthorityPaths(options);
// Independent authority must admit before output creation, bundling or child spawn.
// This entry never loads the baseline trust slot and never authorizes UI/export.
const authority = await admitParticleAuthority({ selection, paths });
assertParticleAuthorityRuntime({
	authority,
	name: "node",
	executable: process.execPath,
	version: process.version,
});
assert.ok(inside("C:/tmps", options["artifacts-root"]));
await plain(options["artifacts-root"], true);
await plain(options["creator-root"], true);
const root = await mkdtemp(
	join(options["artifacts-root"], "particle-authority-compile-"),
);
await mkdir(join(root, "temp"));
await writeParticleCompileContext({ authority, root, selection, paths });
const sources = new Map();
let failure,
	lifecycle,
	outputBytes = 0;
try {
	const version = await nativeCommand(
		options.bun,
		["--version"],
		root,
		"bun-version",
	);
	assertParticleAuthorityRuntime({
		authority,
		name: "bun",
		executable: options.bun,
		version: version.output.trim(),
	});
	await prepareParticleAuthorityCompile({
		repo,
		root,
		options,
		authority,
		sources,
	});
	lifecycle = await runProbeChild({
		executable: options.bun,
		args: [
			join(root, "host.mjs"),
			root,
			options.toolchain,
			join(root, "particle-compile-authority-context.json"),
		],
		cwd: repo,
		env: {
			...process.env,
			TEMP: join(root, "temp"),
			TMP: join(root, "temp"),
			TMPDIR: join(root, "temp"),
			ELFTIA_HTML_FRAME_CONNECTION_FILE: "",
			ROCUT_HTML_BROWSER_PATH: "",
		},
		// Raw child output is not persisted or forwarded; Host retains redacted failures.
		onOutput(bytes) {
			outputBytes += bytes.length;
		},
	});
} catch (error) {
	failure = error;
	lifecycle = error.lifecycle ?? lifecycle;
} finally {
	const errors = [],
		changed = [];
	try {
		await authority.assertUnchanged();
		await verifyParticleAuthorityStage({ authority, root });
	} catch (error) {
		errors.push(error);
	}
	for (const entry of sources.values()) {
		try {
			if (hash(await readFile(entry.path)) !== entry.sha256)
				changed.push(entry.path);
		} catch {
			changed.push(entry.path);
		}
	}
	await writeJson(join(root, "compile-input-stability.json"), {
		stable: changed.length === 0,
		changed,
		authorityReceiptSha256: authority.authorityReceiptSha256,
	});
	await writeJson(join(root, "compile-launcher-lifecycle.json"), {
		lifecycle,
		outputBytes,
		rawOutputRetained: false,
		browserLaunched: false,
	});
	if (changed.length) errors.push(Error("Compile inputs changed"));
	if (errors.length)
		failure = new AggregateError(
			[failure, ...errors].filter(Boolean),
			"Compile or closure verification failed",
		);
}
if (failure) {
	await writeJson(join(root, "prepare-failure.json"), {
		status: "failed",
		error: failure.name,
		root,
		artifactsRetained: true,
		selfApproved: false,
	});
	throw Error("Particle compile failed; retained redacted artifacts: " + root);
}
assert.equal(lifecycle.status, "passed");
assert.equal(lifecycle.closed, true);
const hostReceipt = join(root, "evidence.json"),
	draft = await readJson(join(root, "host-baseline-draft.json"));
const producerPath = join(root, "compile-producer-receipt.json");
await writeJson(producerPath, {
	schema: "particle-compile-producer-closure/v1",
	status: "compiled-unapproved",
	authorityReceiptSha256: authority.authorityReceiptSha256,
	hostReceipt: { path: hostReceipt, sha256: hash(await readFile(hostReceipt)) },
	launcherReceiptSha256: hash(
		await readFile(join(root, "compile-launcher-lifecycle.json")),
	),
	inputStabilityReceiptSha256: hash(
		await readFile(join(root, "compile-input-stability.json")),
	),
	sourceManifestSha256: hash(
		await readFile(join(root, "compile-source-manifest.json")),
	),
	metafileSha256: hash(
		await readFile(join(root, "compile-host-metafile.json")),
	),
	browserLaunched: false,
	selfApproved: false,
	artifactsRetained: true,
});
await writeJson(join(root, "baseline-compile-receipt.proposed.json"), {
	...draft,
	producerReceipt: {
		path: producerPath,
		sha256: hash(await readFile(producerPath)),
	},
});
console.log(
	JSON.stringify({
		status: "compiled-unapproved",
		root,
		baselineReceipt: join(root, "baseline-compile-receipt.proposed.json"),
		selfApproved: false,
		browserLaunched: false,
	}),
);
