import assert from "node:assert/strict";
import { constants } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	hash,
	inside,
	plain,
	readJson,
	treeManifest,
	writeJson,
} from "./particle-c4-export-support.mjs";
import {
	EDITOR_EXPORT_CONTRACT,
	assertUiGeometry,
	loadEditorExportHandoff,
} from "./fixtures/particle-editor-export-contract.mjs";
import { verifyEditorExport } from "./fixtures/particle-editor-export-verify.mjs";

// This is a CPU-only verification of one retained, failed export. It cannot
// render frames, open a Host/browser, replace references, or relax thresholds.
export const ORIGINAL_VIDEO_SHA256 =
	"556833f49da3930c5300f929890daba3a1475027307337afadb47fc6b1459451";
const originalHandoffSha256 =
	"9991d76ae5321170e6a457b4f89d9cf48499c705c558187103a55e39b6df6a5f";
const originalEvidence = Object.freeze({
	"particle.webm": ORIGINAL_VIDEO_SHA256,
	"ui-export-handoff.json": originalHandoffSha256,
	"browser-export-evidence.json":
		"089fcd027d38f3132233493d2f97f5150ae433a62dcb8884e43376c9b9d2e80b",
	"decode-ui-verification.json":
		"0d7219abb4f87dc637f46949bc0d9c845ea6e8735b4a9c45be4ed538762ad4fd",
	"failure.json":
		"b34a76a8366fd48b5fc28dfedfc4f8f8fa3951966636d4d312fd336bb30e99e0",
	"host-input-evidence.json":
		"8a410c5a2de9ecef2b1eb455800702d98a45650c17b45bc8f7ce9463eac793a6",
	"project-copy-manifest.json":
		"6effb7b20c1a8b11c71348adf37e499ea9a6c32c42c97b2dbdc18bd6160479e7",
	"source-manifest.json":
		"bf0d8daf25438aaa4ff724c375d1ab1e29e4d4f9a767b42cc1f1902c324ab057",
	"source-stability.json":
		"1fa4e500410a4ecd6b880a6c19134f0516077fe4458835b1605b60cbeeed917f",
	"ui-input-stability.json":
		"46d35af16126222e39702a661cbeda1121d1ef13c4e6e869c1643e3b4c390d05",
	"public-credential-scan.json":
		"052169e4dca8c6f0e8d13f651d1c2d20541737c3be32aa0f2b41d9e301510cb5",
	"host-children.json":
		"4e6f7a892b2b05886297048bd6cba38637a9d455d6fbef1bbfa07ffa2ded6d13",
	"ui-reference-inputs.json":
		"34378fa881c6669dddb4e424eeae960732b7ebaef3fbd3269816555af6ef239a",
});
const ownPath = fileURLToPath(import.meta.url);
const repo = resolve(dirname(ownPath), "..");
const frozenDependencies = [
	"script/fixtures/particle-editor-export-contract.mjs",
	"script/fixtures/particle-editor-export-verify.mjs",
	"script/fixtures/particle-project-export-pixels.mjs",
	"script/particle-c4-export-support.mjs",
	"script/probe-child-lifecycle.mjs",
];

async function fileFingerprint(path) {
	await plain(path, false);
	const bytes = await readFile(path);
	return { path: resolve(path), bytes: bytes.length, sha256: hash(bytes) };
}

export async function admitOriginalExport(sourceRoot) {
	assert.ok(isAbsolute(sourceRoot) && inside("C:/tmps", sourceRoot));
	await plain(sourceRoot, true);
	for (const [name, sha256] of Object.entries(originalEvidence))
		assert.equal(
			(await fileFingerprint(join(sourceRoot, name))).sha256,
			sha256,
			`Retained original evidence changed: ${name}`,
		);
	const references = await readJson(
		join(sourceRoot, "ui-reference-inputs.json"),
	);
	const admitted = await loadEditorExportHandoff(references.handoffPath);
	assert.equal(admitted.handoffSha256, originalHandoffSha256);
	assert.equal(admitted.stateSha256, references.stateSha256);
	assert.deepEqual(
		await treeManifest(join(sourceRoot, "project")),
		admitted.projectManifest,
	);
	for (const name of ["expected-ui-state.json", "reopened-ui-state.json"])
		assert.deepEqual(await readJson(join(sourceRoot, name)), admitted.state);
	assert.deepEqual(
		await readJson(join(sourceRoot, "persisted-project.json")),
		admitted.wrapper,
	);
	const exported = await readJson(
		join(sourceRoot, "browser-export-evidence.json"),
	);
	assert.equal(exported.frameCount, 121);
	assert.deepEqual(exported.range, {
		startTime: 0,
		endTime: 484000,
		duration: 484000,
	});
	const decoded = await readJson(
		join(sourceRoot, "decode-ui-verification.json"),
	);
	assert.equal(decoded.status, "failed");
	assert.equal(decoded.fullDecode.frames, 121);
	assert.equal(decoded.fullDecode.allFramesDecoded, true);
	assert.equal(decoded.timestamps.length, 121);
	assert.deepEqual(
		decoded.failures,
		EDITOR_EXPORT_CONTRACT.frames.map(
			(frame) => `Real UI comparison rejected frame ${frame}`,
		),
	);
	for (const [index, timestamp] of decoded.timestamps.entries()) {
		assert.equal(timestamp.index, index);
		assert.ok(
			Math.abs(timestamp.actualSeconds - index / 30) <=
				EDITOR_EXPORT_CONTRACT.limits.timestampToleranceSeconds +
					Number.EPSILON,
		);
	}
	const host = await readJson(join(sourceRoot, "host-input-evidence.json"));
	assert.equal(host.sourceBackend, "elftia-electron-particle-session-v2");
	assert.equal(
		host.projectSha256,
		admitted.projectManifest.files.find((file) => file.path === "project.json")
			.sha256,
	);
	const failure = await readJson(join(sourceRoot, "failure.json"));
	assert.equal(failure.browserClosed, true);
	assert.equal(failure.hostLifecycle.closed, true);
	assert.equal(failure.hostLifecycle.code, 0);
	assert.deepEqual(failure.errors, []);
	assert.deepEqual(failure.externalRequests, []);
	assert.equal(
		(await readJson(join(sourceRoot, "host-children.json")))
			.allObservedDirectChildrenClosed,
		true,
	);
	assert.equal(
		(await readJson(join(sourceRoot, "public-credential-scan.json"))).passed,
		true,
	);
	assert.equal(
		(await readJson(join(sourceRoot, "source-stability.json"))).stable,
		true,
	);
	assert.ok(
		Object.values(
			await readJson(join(sourceRoot, "ui-input-stability.json")),
		).every((value) => value === true),
	);
	const sourceManifest = await readJson(
		join(sourceRoot, "source-manifest.json"),
	);
	const sources = [];
	for (const relativePath of frozenDependencies) {
		const actual = await fileFingerprint(join(repo, relativePath));
		const expected = sourceManifest.sources.find(
			(entry) =>
				resolve(entry.path).toLowerCase() === actual.path.toLowerCase(),
		);
		assert.ok(expected, `Missing frozen verifier dependency: ${relativePath}`);
		assert.equal(
			actual.sha256,
			expected.sha256,
			`Frozen verifier dependency changed: ${relativePath}`,
		);
		sources.push(actual);
	}
	sources.push(await fileFingerprint(ownPath));
	return { admitted, oldHandoffPath: references.handoffPath, sources };
}

export function assertSameSavedUi(original, current) {
	assert.deepEqual(
		current.projectManifest,
		original.projectManifest,
		"Saved project and every attachment must remain byte-identical",
	);
	assert.deepEqual(current.wrapper, original.wrapper);
	assert.equal(
		current.stateSha256,
		original.stateSha256,
		"Complete UI state sidecar must remain byte-identical",
	);
	assert.deepEqual(current.state, original.state);
	assert.equal(current.handoff.revision, original.handoff.revision);
	assert.deepEqual(current.handoff.final, original.handoff.final);
}

export function assertIntegerUiReferences(handoff) {
	for (const sample of handoff.previewReferences.samples) {
		assertUiGeometry(sample);
		assert.equal(sample.geometry.devicePixelRatio, 1);
		for (const key of ["x", "y", "width", "height"])
			assert.ok(
				Number.isInteger(sample.geometry.bounds[key]),
				"Fresh visible screenshots require measured integer CSS bounds",
			);
		for (const key of ["width", "height"])
			assert.equal(
				sample.visible[key],
				sample.geometry.bounds[key],
				"No outward screenshot rounding is accepted",
			);
		for (const key of [
			"borderLeftWidth",
			"borderTopWidth",
			"borderRightWidth",
			"borderBottomWidth",
		])
			assert.equal(
				sample.geometry.css[key],
				"0px",
				"The canvas itself must have no CSS border",
			);
	}
}

function parseOptions(args) {
	const required = [
		"source-root",
		"handoff",
		"handoff-sha256",
		"artifacts-root",
		"ffmpeg",
		"ffprobe",
	];
	const options = {};
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index]?.slice(2),
			value = args[index + 1];
		assert.ok(
			args[index]?.startsWith("--") &&
				[...required, "mode"].includes(key) &&
				!options[key] &&
				value,
			"Unknown, missing or duplicate option",
		);
		if (!["mode", "handoff-sha256"].includes(key))
			assert.ok(isAbsolute(value), "Explicit absolute paths required");
		options[key] = value;
	}
	assert.ok(
		required.every((key) => options[key]),
		"Missing required options",
	);
	options.mode ??= "check-only";
	assert.ok(["check-only", "verify"].includes(options.mode));
	assert.match(options["handoff-sha256"], /^[a-f0-9]{64}$/);
	return options;
}

async function run(args) {
	const options = parseOptions(args);
	assert.ok(inside("C:/tmps", options["artifacts-root"]));
	await plain(options["artifacts-root"], true);
	const original = await admitOriginalExport(options["source-root"]);
	const current = await loadEditorExportHandoff(options.handoff);
	assert.equal(current.handoffSha256, options["handoff-sha256"]);
	assertSameSavedUi(original.admitted, current);
	assertIntegerUiReferences(current.handoff);
	const sources = [
		...original.sources,
		await fileFingerprint(options.ffmpeg),
		await fileFingerprint(options.ffprobe),
	];
	for (const protectedRoot of [
		options["source-root"],
		current.handoff.project,
		original.admitted.handoff.project,
		dirname(options.handoff),
	])
		assert.ok(
			resolve(options["artifacts-root"]).toLowerCase() !==
				resolve(protectedRoot).toLowerCase() &&
				!inside(protectedRoot, options["artifacts-root"]),
			"New evidence must remain outside original inputs",
		);
	if (options.mode === "check-only") {
		console.log(
			JSON.stringify({
				status: "check-only-passed",
				originalVideoSha256: ORIGINAL_VIDEO_SHA256,
				handoffSha256: current.handoffSha256,
				sameSavedProjectStateAndAttachments: true,
				integerUiGeometry: true,
				hostBrowserGpuOrFfmpegStarted: false,
			}),
		);
		return;
	}
	const originalTree = await treeManifest(options["source-root"]);
	const root = await mkdtemp(
		join(options["artifacts-root"], "particle-video-reverify-"),
	);
	console.log(
		JSON.stringify({
			root,
			mode: "reverify-existing-video",
			rendersNewFrames: false,
		}),
	);
	let failure, result;
	const copied = [];
	async function copyExact(source, target, expectedHash) {
		await plain(source, false);
		assert.equal(hash(await readFile(source)), expectedHash);
		await copyFile(source, target, constants.COPYFILE_EXCL);
		const fingerprint = await fileFingerprint(target);
		assert.equal(fingerprint.sha256, expectedHash);
		copied.push(fingerprint);
	}
	try {
		await mkdir(join(root, "ui"));
		await copyExact(
			join(options["source-root"], "particle.webm"),
			join(root, "particle.webm"),
			ORIGINAL_VIDEO_SHA256,
		);
		await copyExact(
			options.handoff,
			join(root, "ui-export-handoff.json"),
			current.handoffSha256,
		);
		await copyExact(
			resolve(dirname(options.handoff), current.handoff.final.fullStateFile),
			join(root, "expected-ui-state.json"),
			current.stateSha256,
		);
		for (const file of current.files)
			await copyExact(
				file.path,
				join(root, "ui", `${file.kind}-${file.frame}.png`),
				file.sha256,
			);
		await writeJson(join(root, "reverification-inputs.json"), {
			version: 1,
			originalRoot: options["source-root"],
			originalRunStatus: "failed",
			originalEvidence,
			originalTreeSha256: hash(JSON.stringify(originalTree)),
			newHandoffPath: options.handoff,
			newHandoffSha256: current.handoffSha256,
			completeUiStateSha256: current.stateSha256,
			savedProjectManifest: current.projectManifest,
			programmaticSourceSha256: current.handoff.final.sourceSha256,
			sameSavedProjectStateAndAttachments: true,
			copied,
			sources,
			contract: EDITOR_EXPORT_CONTRACT,
			rendersNewFrames: false,
			newHostBrowserGpuOrNativeSession: false,
		});
		result = await verifyEditorExport({
			root,
			ffmpeg: options.ffmpeg,
			ffprobe: options.ffprobe,
			handoff: current.handoff,
		});
	} catch (error) {
		failure = error;
	} finally {
		try {
			assert.deepEqual(
				await treeManifest(options["source-root"]),
				originalTree,
				"Original failed run must remain entirely unchanged",
			);
			for (const [path, admitted] of [
				[original.oldHandoffPath, original.admitted],
				[options.handoff, current],
			]) {
				const after = await loadEditorExportHandoff(path);
				assert.equal(after.handoffSha256, admitted.handoffSha256);
				assertSameSavedUi(admitted, after);
			}
			for (const entry of [...sources, ...copied])
				assert.deepEqual(
					await fileFingerprint(entry.path),
					entry,
					"Verification source/tool/copied input changed",
				);
			await writeJson(join(root, "input-stability.json"), {
				originalFailedRunEntireTreeUnchanged: true,
				originalAndNewUiInputsUnchanged: true,
				copiedInputsUnchanged: true,
				verifierAndToolsUnchanged: true,
			});
		} catch (error) {
			failure = new AggregateError(
				failure ? [failure, error] : [error],
				"Reverification or input stability failed",
			);
		}
	}
	if (failure) {
		// Admission inputs are local hash-pinned records, never capability files.
		const format = (error) => ({
			error: String(error),
			stack: error.stack,
			...(error instanceof AggregateError
				? { causes: [...error.errors].map(format) }
				: {}),
		});
		await writeJson(join(root, "failure.json"), {
			...format(failure),
			originalRunStatus: "failed",
			originalEvidenceNotRewritten: true,
			artifactsRetained: true,
			rendersNewFrames: false,
		});
		throw Error(`Reverification failed; retained evidence: ${root}`);
	}
	await writeJson(join(root, "evidence.json"), {
		version: 1,
		status: "reverified-existing-video-passed",
		originalRunStatus: "failed",
		originalEvidenceNotRewritten: true,
		videoSha256: ORIGINAL_VIDEO_SHA256,
		newHandoffSha256: current.handoffSha256,
		rendersNewFrames: false,
		scope: EDITOR_EXPORT_CONTRACT.coverage,
		independentDecode: result,
		originalInputsUnmodified: true,
		artifactsRetained: true,
		credentialScope:
			"No capability descriptor parsed or copied, no new Host/browser/native session; original tree is hashed including private files, not a scan for arbitrary unknown secrets",
	});
	console.log(
		JSON.stringify({
			status: "reverified-existing-video-passed",
			root,
			evidenceSha256: hash(await readFile(join(root, "evidence.json"))),
		}),
	);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(ownPath)) {
	await run(process.argv.slice(2));
}
