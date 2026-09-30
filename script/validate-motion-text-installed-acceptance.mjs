#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import {
	dirname,
	extname,
	isAbsolute,
	relative,
	resolve,
	sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const REQUIRED_STEPS = Array.from(
	{ length: 12 },
	(_, index) => `S14-${String(index + 1).padStart(2, "0")}`,
);
const REQUIRED_ARTIFACT_COUNTS = new Map([
	["fixture-project", 1],
	["command-log", 1],
	["ui-screenshot", 3],
	["full-export", 1],
	["range-export", 1],
	["export-metadata", 2],
	["frame-sample", 6],
	["performance-report", 1],
]);
const TEXT_EXTENSIONS = new Set([".json", ".jsonl", ".log", ".md", ".txt"]);
const PRIVATE_PATH =
	/(?:\b[A-Za-z]:[\\/]|\\\\[A-Za-z0-9][A-Za-z0-9._-]*[\\/][^\\/\s]+|(?:^|[\s"'=])\/(?:Users|home|root|tmp|var|opt|mnt|workspace|workspaces|private)\/)/mu;
const SECRET =
	/(?:authorization\s*:\s*bearer\s+\S+|[?&](?:token|secret|key|auth)=[^&\s]+|["'](?:access[_-]?token|api[_-]?key|secret)["']\s*:\s*["'](?!<redacted>)[^"']+)/iu;

function fail(message) {
	throw new Error(message);
}

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, context) {
	if (!isRecord(value)) fail(`${context} must be an object`);
	return value;
}

function requireString(value, context) {
	if (typeof value !== "string" || value.length === 0) {
		fail(`${context} must be a non-empty string`);
	}
	return value;
}

function requireInteger(value, context, minimum = 0) {
	if (!Number.isSafeInteger(value) || value < minimum) {
		fail(`${context} must be an integer >= ${minimum}`);
	}
	return value;
}

function strictUtf8(bytes, context) {
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xef &&
		bytes[1] === 0xbb &&
		bytes[2] === 0xbf
	) {
		fail(`${context} must be UTF-8 without a BOM`);
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		fail(`${context} is not valid UTF-8`);
	}
}

function readStrictJson(path, context) {
	const text = strictUtf8(readFileSync(path), context);
	try {
		return { text, value: JSON.parse(text) };
	} catch (error) {
		fail(`${context} is not valid JSON: ${error.message}`);
	}
}

function requireLogicalPath(value, context) {
	const logicalPath = requireString(value, context);
	if (
		logicalPath.includes("\\") ||
		isAbsolute(logicalPath) ||
		logicalPath
			.split("/")
			.some((part) => part === "" || part === "." || part === "..")
	) {
		fail(`${context} must be a canonical relative path`);
	}
	return logicalPath;
}

function resolveArtifact(root, logicalPath, context) {
	const absoluteRoot = resolve(root);
	const absolutePath = resolve(absoluteRoot, ...logicalPath.split("/"));
	if (!absolutePath.startsWith(`${absoluteRoot}${sep}`)) {
		fail(`${context} escapes the evidence root`);
	}
	return absolutePath;
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function collectEvidenceFiles(root, manifestPath) {
	const files = [];
	const walk = (directory) => {
		const entries = readdirSync(directory, { withFileTypes: true });
		entries.sort((left, right) =>
			left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
		);
		for (const entry of entries) {
			const absolutePath = resolve(directory, entry.name);
			if (absolutePath === manifestPath) continue;
			const logicalPath = relative(root, absolutePath).split(sep).join("/");
			if (entry.isDirectory()) {
				walk(absolutePath);
			} else if (entry.isFile()) {
				files.push(logicalPath);
			} else {
				fail(`evidence closure contains a non-regular entry: ${logicalPath}`);
			}
		}
	};
	walk(root);
	return files;
}

function validateIdentity(value, context) {
	const identity = requireRecord(value, context);
	requireInteger(identity.bytes, `${context}.bytes`, 1);
	if (!SHA256.test(identity.sha256 ?? "")) {
		fail(`${context}.sha256 must be a lowercase SHA-256 digest`);
	}
	return identity;
}

function assertNoPrivateEvidence(text, context) {
	if (PRIVATE_PATH.test(text))
		fail(`${context} contains a private absolute path`);
	if (SECRET.test(text))
		fail(`${context} contains an unredacted secret or token`);
}

function assertMagic(bytes, kind, logicalPath) {
	if (kind === "ui-screenshot" || kind === "frame-sample") {
		const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
		if (
			bytes.length < png.length ||
			!png.every((byte, index) => bytes[index] === byte)
		) {
			fail(`${logicalPath} must be a PNG for artifact kind ${kind}`);
		}
	}
	if (kind === "full-export" || kind === "range-export") {
		if (
			bytes.length < 12 ||
			bytes.subarray(4, 8).toString("ascii") !== "ftyp"
		) {
			fail(`${logicalPath} must be an MP4 with an ftyp box`);
		}
	}
}

function validateStepFacts(stepById) {
	const conflict = requireRecord(stepById.get("S14-08").facts, "S14-08.facts");
	for (const key of ["conflictObserved", "retrySucceeded"]) {
		if (conflict[key] !== true) fail(`S14-08.facts.${key} must be true`);
	}
	requireString(conflict.stableCueId, "S14-08.facts.stableCueId");
	for (const key of [
		"projectRevisionBefore",
		"sequenceRevisionBefore",
		"projectRevisionAfter",
		"sequenceRevisionAfter",
	]) {
		requireInteger(conflict[key], `S14-08.facts.${key}`);
	}

	const panel = requireRecord(stepById.get("S14-11").facts, "S14-11.facts");
	for (const key of ["exportRejectedWithoutPane", "businessReadSucceeded"]) {
		if (panel[key] !== true) fail(`S14-11.facts.${key} must be true`);
	}

	const diagnostics = requireRecord(
		stepById.get("S14-12").facts,
		"S14-12.facts",
	);
	for (const key of [
		"missingFontDiagnostic",
		"oldPluginDiagnostic",
		"unknownPresetDiagnostic",
		"recoverySucceeded",
	]) {
		if (diagnostics[key] !== true) fail(`S14-12.facts.${key} must be true`);
	}
}

function requireMatchingFields(actualValue, expected, fields, context) {
	const actual = requireRecord(actualValue, context);
	for (const field of fields) {
		if (actual[field] !== expected[field]) {
			fail(
				`${context}.${field} does not match the acceptance manifest: ${actual[field]} != ${expected[field]}`,
			);
		}
	}
}

function validateExports(exports, artifactsByPath) {
	if (!Array.isArray(exports) || exports.length !== 2) {
		fail("exports must contain exactly the full and selected-range results");
	}
	const labels = new Set();
	for (const [index, entryValue] of exports.entries()) {
		const entry = requireRecord(entryValue, `exports[${index}]`);
		if (entry.label !== "full" && entry.label !== "selected") {
			fail(`exports[${index}].label must be full or selected`);
		}
		if (labels.has(entry.label)) fail(`duplicate export label: ${entry.label}`);
		labels.add(entry.label);
		const expectedKind =
			entry.label === "full" ? "full-export" : "range-export";
		const artifactPath = requireLogicalPath(
			entry.artifactPath,
			`exports[${index}].artifactPath`,
		);
		if (artifactsByPath.get(artifactPath)?.kind !== expectedKind) {
			fail(`${artifactPath} must be declared as ${expectedKind}`);
		}
		const metadataPath = requireLogicalPath(
			entry.metadataPath,
			`exports[${index}].metadataPath`,
		);
		const metadataArtifact = artifactsByPath.get(metadataPath);
		if (metadataArtifact?.kind !== "export-metadata") {
			fail(`${metadataPath} must be declared as export-metadata`);
		}
		if (entry.width !== 1920 || entry.height !== 1080) {
			fail(`${entry.label} export must be 1920x1080`);
		}
		requireInteger(entry.fpsNumerator, `${entry.label}.fpsNumerator`, 1);
		requireInteger(entry.fpsDenominator, `${entry.label}.fpsDenominator`, 1);
		const expectedFrames = requireInteger(
			entry.expectedFrameCount,
			`${entry.label}.expectedFrameCount`,
			1,
		);
		const actualFrames = requireInteger(
			entry.actualFrameCount,
			`${entry.label}.actualFrameCount`,
			1,
		);
		if (Math.abs(expectedFrames - actualFrames) > 1) {
			fail(`${entry.label} export frame count differs by more than one frame`);
		}
		if (entry.videoStreams !== 1 || entry.audioStreams !== 1) {
			fail(
				`${entry.label} export must contain exactly one video and one audio stream`,
			);
		}
		if (
			typeof entry.audioVideoOffsetFrames !== "number" ||
			entry.audioVideoOffsetFrames < 0 ||
			entry.audioVideoOffsetFrames > 1
		) {
			fail(`${entry.label} export A/V offset must be within one frame`);
		}
		const startTick = requireInteger(
			entry.startTick,
			`${entry.label}.startTick`,
		);
		const endTick = requireInteger(entry.endTick, `${entry.label}.endTick`, 1);
		if (endTick <= startTick)
			fail(`${entry.label} export range must be non-empty`);
		if (entry.label === "full" && startTick !== 0)
			fail("full export must start at tick 0");
		if (entry.label === "selected" && startTick === 0) {
			fail("selected export must prove a non-zero range offset");
		}
		if (!Array.isArray(entry.frameSamples) || entry.frameSamples.length !== 3) {
			fail(
				`${entry.label} export must reference first/middle/last frame samples`,
			);
		}
		const samples = new Set();
		for (const sampleValue of entry.frameSamples) {
			const sample = requireLogicalPath(
				sampleValue,
				`${entry.label}.frameSamples`,
			);
			if (artifactsByPath.get(sample)?.kind !== "frame-sample") {
				fail(`${sample} must be declared as frame-sample`);
			}
			samples.add(sample);
		}
		if (samples.size !== 3)
			fail(`${entry.label} frame samples must be distinct`);
		requireMatchingFields(
			metadataArtifact.parsedJson,
			{
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
			},
			[
				"width",
				"height",
				"fpsNumerator",
				"fpsDenominator",
				"frameCount",
				"videoStreams",
				"audioStreams",
				"audioVideoOffsetFrames",
				"startTick",
				"endTick",
			],
			metadataPath,
		);
	}
	if (!labels.has("full") || !labels.has("selected")) {
		fail("exports must contain full and selected labels");
	}
}

function validatePerformance(value, artifactsByPath) {
	const performance = requireRecord(value, "performance");
	const artifactPath = requireLogicalPath(
		performance.artifactPath,
		"performance.artifactPath",
	);
	const performanceArtifact = artifactsByPath.get(artifactPath);
	if (performanceArtifact?.kind !== "performance-report") {
		fail(`${artifactPath} must be declared as performance-report`);
	}
	for (const [key, budget] of [
		["previewP95Ms", 33.3],
		["seekP95Ms", 250],
		["mutationP95Ms", 300],
		["cancelLatencyMs", 1000],
	]) {
		if (typeof performance[key] !== "number" || performance[key] < 0) {
			fail(`performance.${key} must be a non-negative number`);
		}
		if (performance[key] > budget) {
			fail(`performance.${key} exceeds the ${budget} ms budget`);
		}
	}
	if (performance.memoryPlateauObserved !== true) {
		fail("performance.memoryPlateauObserved must be true");
	}
	if (performance.gpuReleaseObserved !== true) {
		fail("performance.gpuReleaseObserved must be true");
	}
	requireInteger(
		performance.fullExportDurationMs,
		"performance.fullExportDurationMs",
		1,
	);
	requireMatchingFields(
		performanceArtifact.parsedJson,
		performance,
		[
			"previewP95Ms",
			"seekP95Ms",
			"mutationP95Ms",
			"cancelLatencyMs",
			"memoryPlateauObserved",
			"gpuReleaseObserved",
			"fullExportDurationMs",
		],
		artifactPath,
	);
}

export function validateInstalledAcceptance(manifestPath) {
	const absoluteManifestPath = resolve(manifestPath);
	const { text: manifestText, value } = readStrictJson(
		absoluteManifestPath,
		"installed acceptance manifest",
	);
	assertNoPrivateEvidence(manifestText, "installed acceptance manifest");
	const manifest = requireRecord(value, "manifest");
	if (manifest.schemaVersion !== 1) fail("manifest.schemaVersion must be 1");

	const source = requireRecord(manifest.source, "source");
	for (const key of ["rocutCommit", "pluginCommit", "pluginUpstreamCommit"]) {
		if (!COMMIT.test(source[key] ?? ""))
			fail(`source.${key} must be a 40-character commit`);
	}
	if (source.pluginUpstreamCommit !== source.rocutCommit) {
		fail("source.pluginUpstreamCommit must equal source.rocutCommit");
	}
	requireString(source.pluginVersion, "source.pluginVersion");
	const canonicalWasm = validateIdentity(
		source.canonicalWasm,
		"source.canonicalWasm",
	);
	const installedWasm = validateIdentity(
		source.installedWasm,
		"source.installedWasm",
	);
	validateIdentity(source.fontCatalog, "source.fontCatalog");
	if (
		canonicalWasm.bytes !== installedWasm.bytes ||
		canonicalWasm.sha256 !== installedWasm.sha256
	) {
		fail("installed WASM identity must equal canonical WASM identity");
	}

	const environment = requireRecord(manifest.environment, "environment");
	for (const key of [
		"isolatedInstall",
		"rocutSiblingCheckoutAbsent",
		"jizuraSiblingCheckoutAbsent",
	]) {
		if (environment[key] !== true) fail(`environment.${key} must be true`);
	}
	if (environment.systemFontFallbackUsed !== false) {
		fail("environment.systemFontFallbackUsed must be false");
	}
	requireString(environment.os, "environment.os");
	requireString(environment.arch, "environment.arch");
	requireString(environment.browser, "environment.browser");
	const viewport = requireRecord(environment.viewport, "environment.viewport");
	if (viewport.width !== 1920 || viewport.height !== 1080) {
		fail("environment.viewport must be 1920x1080");
	}

	if (!Array.isArray(manifest.artifacts)) fail("artifacts must be an array");
	const evidenceRoot = dirname(absoluteManifestPath);
	const artifactsByPath = new Map();
	const artifactCounts = new Map();
	for (const [index, artifactValue] of manifest.artifacts.entries()) {
		const artifact = requireRecord(artifactValue, `artifacts[${index}]`);
		const logicalPath = requireLogicalPath(
			artifact.path,
			`artifacts[${index}].path`,
		);
		if (artifactsByPath.has(logicalPath))
			fail(`duplicate artifact path: ${logicalPath}`);
		const kind = requireString(artifact.kind, `artifacts[${index}].kind`);
		const expectedBytes = requireInteger(
			artifact.bytes,
			`artifacts[${index}].bytes`,
			1,
		);
		if (!SHA256.test(artifact.sha256 ?? "")) {
			fail(`artifacts[${index}].sha256 must be a lowercase SHA-256 digest`);
		}
		const absoluteArtifactPath = resolveArtifact(
			evidenceRoot,
			logicalPath,
			logicalPath,
		);
		if (!lstatSync(absoluteArtifactPath).isFile()) {
			fail(
				`${logicalPath} must be a regular file, not a link or special entry`,
			);
		}
		const bytes = readFileSync(absoluteArtifactPath);
		if (bytes.length !== expectedBytes) {
			fail(`${logicalPath} byte count does not match the manifest`);
		}
		if (sha256(bytes) !== artifact.sha256) {
			fail(`${logicalPath} SHA-256 does not match the manifest`);
		}
		assertMagic(bytes, kind, logicalPath);
		let parsedJson;
		if (TEXT_EXTENSIONS.has(extname(logicalPath).toLowerCase())) {
			const text = strictUtf8(bytes, logicalPath);
			assertNoPrivateEvidence(text, logicalPath);
			if (
				kind === "fixture-project" ||
				kind === "export-metadata" ||
				kind === "performance-report"
			) {
				try {
					parsedJson = JSON.parse(text);
				} catch {
					fail(
						`${logicalPath} must contain valid JSON for artifact kind ${kind}`,
					);
				}
			}
		}
		artifactsByPath.set(logicalPath, { ...artifact, kind, parsedJson });
		artifactCounts.set(kind, (artifactCounts.get(kind) ?? 0) + 1);
	}
	for (const [kind, minimum] of REQUIRED_ARTIFACT_COUNTS) {
		if ((artifactCounts.get(kind) ?? 0) < minimum) {
			fail(`artifacts must contain at least ${minimum} ${kind} item(s)`);
		}
	}
	const declaredPaths = [...artifactsByPath.keys()].sort();
	const actualPaths = collectEvidenceFiles(evidenceRoot, absoluteManifestPath);
	if (JSON.stringify(actualPaths) !== JSON.stringify(declaredPaths)) {
		fail(
			`evidence file closure does not match the manifest: expected ${declaredPaths.join(", ")}; found ${actualPaths.join(", ")}`,
		);
	}

	if (
		!Array.isArray(manifest.steps) ||
		manifest.steps.length !== REQUIRED_STEPS.length
	) {
		fail("steps must contain all 12 final acceptance steps");
	}
	const stepById = new Map();
	for (const [index, stepValue] of manifest.steps.entries()) {
		const step = requireRecord(stepValue, `steps[${index}]`);
		const id = requireString(step.id, `steps[${index}].id`);
		if (!REQUIRED_STEPS.includes(id) || stepById.has(id))
			fail(`invalid or duplicate step id: ${id}`);
		if (step.status !== "passed") fail(`${id}.status must be passed`);
		if (!Array.isArray(step.evidence) || step.evidence.length === 0) {
			fail(`${id}.evidence must contain at least one artifact path`);
		}
		for (const evidenceValue of step.evidence) {
			const evidence = requireLogicalPath(evidenceValue, `${id}.evidence`);
			if (!artifactsByPath.has(evidence))
				fail(`${id} references undeclared evidence: ${evidence}`);
		}
		stepById.set(id, step);
	}
	for (const id of REQUIRED_STEPS) {
		if (!stepById.has(id)) fail(`missing final acceptance step: ${id}`);
	}
	validateStepFacts(stepById);
	validateExports(manifest.exports, artifactsByPath);
	validatePerformance(manifest.performance, artifactsByPath);

	return {
		steps: stepById.size,
		artifacts: artifactsByPath.size,
		exports: manifest.exports.length,
		pluginVersion: source.pluginVersion,
		rocutCommit: source.rocutCommit,
	};
}

function option(name) {
	const index = process.argv.indexOf(name);
	if (index < 0) return null;
	const value = process.argv[index + 1];
	if (!value || value.startsWith("--")) fail(`${name} requires a value`);
	return value;
}

const isMain =
	process.argv[1] !== undefined &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	try {
		const manifestPath = option("--manifest");
		if (!manifestPath) fail("--manifest <path> is required");
		const result = validateInstalledAcceptance(manifestPath);
		console.log(
			`installed motion-text acceptance: PASS (${result.steps} steps, ${result.artifacts} artifacts, ${result.exports} exports, plugin ${result.pluginVersion})`,
		);
	} catch (error) {
		console.error(
			`installed motion-text acceptance: FAIL: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	}
}
