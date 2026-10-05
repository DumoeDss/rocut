import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "bun:test";

import { validateInstalledAcceptance } from "../validate-motion-text-installed-acceptance.mjs";
import { exportMediaFacts } from "../installed-export-media-facts.mjs";

const roots = [];
const SCRIPT = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"validate-motion-text-installed-acceptance.mjs",
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const mp4 = Buffer.from([
	0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

function buildFixture() {
	const root = mkdtempSync(join(tmpdir(), "rocut-installed-acceptance-"));
	roots.push(root);
	const artifacts = [];
	const add = (path, kind, bytes) => {
		const absolute = join(root, ...path.split("/"));
		mkdirSync(dirname(absolute), { recursive: true });
		writeFileSync(absolute, bytes);
		artifacts.push({ path, kind, bytes: bytes.length, sha256: digest(bytes) });
	};
	add(
		"project/project.json",
		"fixture-project",
		Buffer.from('{"schemaVersion":32}\n'),
	);
	add(
		"logs/commands.jsonl",
		"command-log",
		Buffer.from('{"event":"redacted"}\n'),
	);
	for (const name of ["editor", "conflict", "diagnostics"]) {
		add(`screenshots/${name}.png`, "ui-screenshot", png);
	}
	add("exports/full.mp4", "full-export", mp4);
	add("exports/selected.mp4", "range-export", mp4);
	const fullExport = {
		label: "full",
		artifactPath: "exports/full.mp4",
		metadataPath: "exports/full.json",
		width: 1920,
		height: 1080,
		fpsNumerator: 30,
		fpsDenominator: 1,
		expectedFrameCount: 450,
		actualFrameCount: 450,
		videoStreams: 1,
		audioStreams: 1,
		audioVideoOffsetFrames: 0.2,
		startTick: 0,
		endTick: 450000,
		frameSamples: [
			"frames/full-first.png",
			"frames/full-middle.png",
			"frames/full-last.png",
		],
	};
	const selectedExport = {
		label: "selected",
		artifactPath: "exports/selected.mp4",
		metadataPath: "exports/selected.json",
		width: 1920,
		height: 1080,
		fpsNumerator: 30,
		fpsDenominator: 1,
		expectedFrameCount: 60,
		actualFrameCount: 60,
		videoStreams: 1,
		audioStreams: 1,
		audioVideoOffsetFrames: 0.5,
		startTick: 90000,
		endTick: 150000,
		frameSamples: [
			"frames/selected-first.png",
			"frames/selected-middle.png",
			"frames/selected-last.png",
		],
	};
	const metadataFor = (entry) => ({
		width: entry.width,
		height: entry.height,
		fpsNumerator: entry.fpsNumerator,
		fpsDenominator: entry.fpsDenominator,
		frameCount: entry.actualFrameCount,
		videoStreams: entry.videoStreams,
		audioStreams: entry.audioStreams,
		audioVideoOffsetFrames: entry.audioVideoOffsetFrames,
		startTick: entry.startTick,
		endTick: entry.endTick,
	});
	add(
		"exports/full.json",
		"export-metadata",
		Buffer.from(`${JSON.stringify(metadataFor(fullExport))}\n`),
	);
	add(
		"exports/selected.json",
		"export-metadata",
		Buffer.from(`${JSON.stringify(metadataFor(selectedExport))}\n`),
	);
	for (const range of ["full", "selected"]) {
		for (const phase of ["first", "middle", "last"]) {
			add(`frames/${range}-${phase}.png`, "frame-sample", png);
		}
	}
	const performance = {
		artifactPath: "performance/report.json",
		previewP95Ms: 20,
		seekP95Ms: 100,
		mutationP95Ms: 150,
		cancelLatencyMs: 200,
		memoryPlateauObserved: true,
		gpuReleaseObserved: true,
		fullExportDurationMs: 5000,
	};
	add(
		"performance/report.json",
		"performance-report",
		Buffer.from(`${JSON.stringify(performance)}\n`),
	);

	const steps = Array.from({ length: 12 }, (_, index) => ({
		id: `S14-${String(index + 1).padStart(2, "0")}`,
		status: "passed",
		evidence: [artifacts[index % artifacts.length].path],
	}));
	steps[7].facts = {
		conflictObserved: true,
		retrySucceeded: true,
		stableCueId: "cue_fixture_3",
		projectRevisionBefore: 4,
		sequenceRevisionBefore: 2,
		projectRevisionAfter: 6,
		sequenceRevisionAfter: 4,
	};
	steps[10].facts = {
		exportRejectedWithoutPane: true,
		businessReadSucceeded: true,
	};
	steps[11].facts = {
		missingFontDiagnostic: true,
		oldPluginDiagnostic: true,
		unknownPresetDiagnostic: true,
		recoverySucceeded: true,
	};
	const wasm = { bytes: 123, sha256: "a".repeat(64) };
	const manifest = {
		schemaVersion: 1,
		source: {
			rocutCommit: "1".repeat(40),
			pluginCommit: "2".repeat(40),
			pluginUpstreamCommit: "1".repeat(40),
			pluginVersion: "0.5.0",
			canonicalWasm: wasm,
			installedWasm: { ...wasm },
			fontCatalog: { bytes: 456, sha256: "b".repeat(64) },
		},
		environment: {
			isolatedInstall: true,
			rocutSiblingCheckoutAbsent: true,
			jizuraSiblingCheckoutAbsent: true,
			systemFontFallbackUsed: false,
			os: "windows",
			arch: "x64",
			browser: "Chromium fixture",
			viewport: { width: 1920, height: 1080 },
		},
		artifacts,
		steps,
		exports: [fullExport, selectedExport],
		performance,
	};
	const manifestPath = join(root, "acceptance.json");
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	return { root, manifest, manifestPath };
}

function writeManifest(path, manifest) {
	writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function replaceArtifact(root, manifest, logicalPath, value) {
	const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
	writeFileSync(join(root, ...logicalPath.split("/")), bytes);
	const entry = manifest.artifacts.find(
		(artifact) => artifact.path === logicalPath,
	);
	if (!entry) throw new Error(`fixture artifact is missing ${logicalPath}`);
	entry.bytes = bytes.length;
	entry.sha256 = digest(bytes);
}

describe("installed motion-text acceptance evidence", () => {
	test("accepts a complete, isolated and digest-pinned evidence closure", () => {
		const { manifestPath } = buildFixture();
		expect(validateInstalledAcceptance(manifestPath)).toEqual({
			steps: 12,
			artifacts: 16,
			exports: 2,
			pluginVersion: "0.5.0",
			rocutCommit: "1".repeat(40),
		});
	});

	test("exposes the validator through the command-line entry", () => {
		const { manifestPath } = buildFixture();
		const result = spawnSync(
			process.execPath,
			[SCRIPT, "--manifest", manifestPath],
			{
				encoding: "utf8",
			},
		);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain(
			"installed motion-text acceptance: PASS (12 steps, 16 artifacts, 2 exports",
		);
	});

	test("rejects an incomplete final acceptance sequence", () => {
		const { manifest, manifestPath } = buildFixture();
		manifest.steps.pop();
		writeManifest(manifestPath, manifest);
		expect(() => validateInstalledAcceptance(manifestPath)).toThrow(
			"steps must contain all 12 final acceptance steps",
		);
	});

	test("rejects an installed WASM that differs from canonical", () => {
		const { manifest, manifestPath } = buildFixture();
		manifest.source.installedWasm.sha256 = "c".repeat(64);
		writeManifest(manifestPath, manifest);
		expect(() => validateInstalledAcceptance(manifestPath)).toThrow(
			"installed WASM identity must equal canonical WASM identity",
		);
	});

	test("rejects tampered evidence bytes", () => {
		const { root, manifestPath } = buildFixture();
		writeFileSync(join(root, "logs/commands.jsonl"), '{"event":"tampered"}\n');
		expect(() => validateInstalledAcceptance(manifestPath)).toThrow(
			"logs/commands.jsonl SHA-256 does not match the manifest",
		);
	});

	test("rejects unredacted tokens in evidence", () => {
		const { root, manifest, manifestPath } = buildFixture();
		const path = join(root, "logs/commands.jsonl");
		const bytes = Buffer.from('{"access_token":"secret-value"}\n');
		writeFileSync(path, bytes);
		const entry = manifest.artifacts.find(
			(artifact) => artifact.path === "logs/commands.jsonl",
		);
		entry.bytes = bytes.length;
		entry.sha256 = digest(bytes);
		writeManifest(manifestPath, manifest);
		expect(() => validateInstalledAcceptance(manifestPath)).toThrow(
			"logs/commands.jsonl contains an unredacted secret or token",
		);
	});

	test("rejects export evidence that exceeds the one-frame tolerance", () => {
		const { manifest, manifestPath } = buildFixture();
		manifest.exports[1].actualFrameCount += 2;
		writeManifest(manifestPath, manifest);
		expect(() => validateInstalledAcceptance(manifestPath)).toThrow(
			"selected export frame count differs by more than one frame",
		);
	});

	test("rejects measured six-frame A/V drift even when its metadata and digest agree", () => {
		const { root, manifest, manifestPath } = buildFixture();
		const measured = exportMediaFacts({
			streams: [
				{
					codec_type: "video",
					width: 1920,
					height: 1080,
					r_frame_rate: "30/1",
					start_time: "0",
					duration: "15",
					nb_read_frames: "450",
				},
				{ codec_type: "audio", start_time: "0", duration: "15.2" },
			],
		});
		manifest.exports[0].audioVideoOffsetFrames =
			measured.audioVideoOffsetFrames;
		const metadata = JSON.parse(
			readFileSync(join(root, "exports/full.json"), "utf8"),
		);
		metadata.audioVideoOffsetFrames = measured.audioVideoOffsetFrames;
		replaceArtifact(root, manifest, "exports/full.json", metadata);
		writeManifest(manifestPath, manifest);
		expect(() => validateInstalledAcceptance(manifestPath)).toThrow(
			"full export A/V offset must be within one frame",
		);
	});

	test("rejects an undeclared file in the evidence closure", () => {
		const { root, manifestPath } = buildFixture();
		writeFileSync(join(root, "forgotten.log"), "should have been declared\n");
		expect(() => validateInstalledAcceptance(manifestPath)).toThrow(
			"evidence file closure does not match the manifest",
		);
	});

	test("rejects private absolute paths even when the artifact digest is pinned", () => {
		const { root, manifest, manifestPath } = buildFixture();
		const path = join(root, "logs/commands.jsonl");
		const bytes = Buffer.from('{"project":"E:\\\\private\\\\project"}\n');
		writeFileSync(path, bytes);
		const entry = manifest.artifacts.find(
			(artifact) => artifact.path === "logs/commands.jsonl",
		);
		entry.bytes = bytes.length;
		entry.sha256 = digest(bytes);
		writeManifest(manifestPath, manifest);
		expect(() => validateInstalledAcceptance(manifestPath)).toThrow(
			"logs/commands.jsonl contains a private absolute path",
		);
	});

	test("rejects export metadata that contradicts the manifest", () => {
		const { root, manifest, manifestPath } = buildFixture();
		const metadata = JSON.parse(
			readFileSync(join(root, "exports/full.json"), "utf8"),
		);
		metadata.width = 1280;
		replaceArtifact(root, manifest, "exports/full.json", metadata);
		writeManifest(manifestPath, manifest);
		expect(() => validateInstalledAcceptance(manifestPath)).toThrow(
			"exports/full.json.width does not match the acceptance manifest",
		);
	});

	test("keeps the original 250 ms seek budget", () => {
		const { root, manifest, manifestPath } = buildFixture();
		manifest.performance.seekP95Ms = 294;
		replaceArtifact(
			root,
			manifest,
			"performance/report.json",
			manifest.performance,
		);
		writeManifest(manifestPath, manifest);
		expect(() => validateInstalledAcceptance(manifestPath)).toThrow(
			"performance.seekP95Ms exceeds the 250 ms budget",
		);
	});

	test("rejects unmeasured installed performance", () => {
		const { root, manifest, manifestPath } = buildFixture();
		manifest.performance.previewP95Ms = null;
		replaceArtifact(
			root,
			manifest,
			"performance/report.json",
			manifest.performance,
		);
		writeManifest(manifestPath, manifest);
		expect(() => validateInstalledAcceptance(manifestPath)).toThrow(
			"performance.previewP95Ms must be a non-negative number",
		);
	});

	test("rejects a performance sidecar that contradicts the manifest", () => {
		const { root, manifest, manifestPath } = buildFixture();
		const report = JSON.parse(
			readFileSync(join(root, "performance/report.json"), "utf8"),
		);
		report.seekP95Ms = 99;
		replaceArtifact(root, manifest, "performance/report.json", report);
		writeManifest(manifestPath, manifest);
		expect(() => validateInstalledAcceptance(manifestPath)).toThrow(
			"performance/report.json.seekP95Ms does not match the acceptance manifest",
		);
	});
});
