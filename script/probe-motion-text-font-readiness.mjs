#!/usr/bin/env node

import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, statSync } from "node:fs";

import { inspectMotionTextFont } from "../rust/wasm/pkg/opencut_wasm_sync.js";
import {
	MOTION_TEXT_F01_RENDERED_LINES,
	MOTION_TEXT_F01_RENDERED_TEXT,
} from "./fixtures/motion-text-f01-fixture.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_PATH = join(
	ROOT,
	"rust/crates/motion-text/resources/jizura-font-catalog.json",
);
const PUBLIC_ROOT = join(ROOT, "apps/web/public");
const REPORT_PATH = join(ROOT, "docs/motion-text/s09-font-readiness.json");
const WASM_PATH = join(ROOT, "rust/wasm/pkg/opencut_wasm_bg.wasm");
const DEFAULT_ROLE_ID = "gothic_bold";
const F01_LANGUAGE = "zh-Hans";
const CHECK_ONLY = process.argv.includes("--check");

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function fileIdentity(path) {
	const bytes = readFileSync(path);
	return { bytes: statSync(path).size, sha256: sha256(bytes) };
}

function strictJson(path) {
	return JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)),
	);
}

function codePointEvidence(codePoints) {
	return codePoints.map((codePoint) => ({
		codePoint,
		hex: `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
		character: String.fromCodePoint(codePoint),
	}));
}

function inspectBytes(bytes) {
	const result = inspectMotionTextFont({
		bytes,
		text: MOTION_TEXT_F01_RENDERED_TEXT,
		faceIndex: 0,
	});
	if (!result.inspection) {
		throw new Error(
			result.error ?? "Font inspection failed without a diagnostic",
		);
	}
	return result.inspection;
}

function fontRoleId(font) {
	return font.roleId ?? font.id;
}

function languageRangeMatches(language, range) {
	const normalizedLanguage = language.toLowerCase();
	const normalizedRange = range.toLowerCase();
	return (
		normalizedLanguage === normalizedRange ||
		normalizedLanguage.startsWith(`${normalizedRange}-`)
	);
}

function validateFontRoles(fonts) {
	const roleIds = new Set(fonts.map(fontRoleId));
	if (roleIds.size !== 23) {
		throw new Error(`Expected 23 JIZURA font roles, found ${roleIds.size}`);
	}
	for (const roleId of roleIds) {
		if (!fonts.some((font) => font.id === roleId)) {
			throw new Error(`Font role ${roleId} has no stable base asset id`);
		}
	}

	const languageDefaults = new Map();
	for (const font of fonts) {
		for (const language of font.defaultForLanguages ?? []) {
			if (
				!font.supportedLanguages?.some(
					(supported) => supported.toLowerCase() === language.toLowerCase(),
				)
			) {
				throw new Error(
					`${font.id} defaults for undeclared language ${language}`,
				);
			}
			const key = `${fontRoleId(font)}\0${language.toLowerCase()}`;
			if (languageDefaults.has(key)) {
				throw new Error(
					`Duplicate default for role ${fontRoleId(font)} and ${language}`,
				);
			}
			languageDefaults.set(key, font.id);
		}
	}
	return roleIds;
}

function resolveRoleAsset(fonts, roleOrAssetId, language) {
	const explicitAsset = fonts.find(
		(font) => font.id === roleOrAssetId && fontRoleId(font) !== roleOrAssetId,
	);
	if (explicitAsset) return explicitAsset;

	const languageMatches = fonts
		.filter((font) => fontRoleId(font) === roleOrAssetId)
		.map((font) => ({
			font,
			specificity: Math.max(
				-1,
				...(font.defaultForLanguages ?? [])
					.filter((range) => languageRangeMatches(language, range))
					.map((range) => range.length),
			),
		}))
		.filter(({ specificity }) => specificity >= 0)
		.sort((left, right) => right.specificity - left.specificity);
	return (
		languageMatches[0]?.font ?? fonts.find((font) => font.id === roleOrAssetId)
	);
}

function buildReport() {
	const catalog = strictJson(CATALOG_PATH);
	if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.fonts)) {
		throw new Error("JIZURA font catalog does not match schema version 1");
	}
	const roleIds = validateFontRoles(catalog.fonts);

	const rolesByPath = new Map();
	for (const font of catalog.fonts) {
		const roles = rolesByPath.get(font.builtinPath) ?? [];
		roles.push(font);
		rolesByPath.set(font.builtinPath, roles);
	}
	const baseAssetPaths = new Set(
		catalog.fonts
			.filter((font) => font.id === fontRoleId(font))
			.map((font) => font.builtinPath),
	);
	if (baseAssetPaths.size !== 18) {
		throw new Error(
			`Expected 18 base font assets, found ${baseAssetPaths.size}`,
		);
	}
	if (rolesByPath.size < baseAssetPaths.size) {
		throw new Error("Font variant assets cannot reduce the base asset closure");
	}

	const inspectedAssets = [...rolesByPath]
		.map(([builtinPath, roles]) => {
			const declaredDigests = new Set(roles.map((role) => role.contentDigest));
			if (declaredDigests.size !== 1) {
				throw new Error(`${builtinPath} has conflicting declared digests`);
			}
			const bytes = readFileSync(resolve(PUBLIC_ROOT, builtinPath));
			const inspection = inspectBytes(bytes);
			const declaredDigest = [...declaredDigests][0];
			if (inspection.contentDigest !== declaredDigest) {
				throw new Error(
					`${builtinPath} digest mismatch: ${inspection.contentDigest} != ${declaredDigest}`,
				);
			}
			return {
				builtinPath,
				roleIds: [...new Set(roles.map(fontRoleId))].sort(),
				declaredLanguages: [
					...new Set(roles.flatMap((role) => role.supportedLanguages)),
				].sort(),
				contentDigest: inspection.contentDigest,
				bytes: bytes.byteLength,
				glyphCount: inspection.glyphCount,
				coversF01: inspection.missingCodePoints.length === 0,
				missingCodePoints: codePointEvidence(inspection.missingCodePoints),
			};
		})
		.sort((left, right) => left.builtinPath.localeCompare(right.builtinPath));

	const defaultRole = resolveRoleAsset(
		catalog.fonts,
		DEFAULT_ROLE_ID,
		F01_LANGUAGE,
	);
	if (!defaultRole) throw new Error(`Missing default role ${DEFAULT_ROLE_ID}`);
	const defaultAsset = inspectedAssets.find(
		(asset) => asset.builtinPath === defaultRole.builtinPath,
	);
	if (!defaultAsset) {
		throw new Error(`Missing asset for default role ${DEFAULT_ROLE_ID}`);
	}
	const fullCoverageAssets = inspectedAssets.filter((asset) => asset.coversF01);
	const assets = inspectedAssets.map(
		({
			builtinPath,
			roleIds,
			contentDigest,
			glyphCount,
			coversF01,
			missingCodePoints,
		}) => ({
			builtinPath,
			roleIds,
			contentDigest,
			glyphCount,
			coversF01,
			missingCodePointCount: missingCodePoints.length,
		}),
	);

	return {
		schemaVersion: 1,
		generatedBy: "script/probe-motion-text-font-readiness.mjs",
		source: {
			canonicalWasm: fileIdentity(WASM_PATH),
			fontCatalog: fileIdentity(CATALOG_PATH),
		},
		fixture: {
			id: "F01",
			language: F01_LANGUAGE,
			renderedLines: MOTION_TEXT_F01_RENDERED_LINES,
			textSha256: sha256(Buffer.from(MOTION_TEXT_F01_RENDERED_TEXT, "utf8")),
		},
		summary: {
			roles: roleIds.size,
			uniqueAssets: assets.length,
			defaultRoleId: DEFAULT_ROLE_ID,
			defaultAssetPath: defaultAsset.builtinPath,
			defaultMissingCodePointCount: defaultAsset.missingCodePoints.length,
			defaultMissingCodePoints: defaultAsset.missingCodePoints,
			fullCoverageAssets: fullCoverageAssets.map((asset) => asset.builtinPath),
		},
		assets,
	};
}

function option(name) {
	const index = process.argv.indexOf(name);
	if (index < 0) return null;
	const value = process.argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${name} requires a value`);
	}
	return value;
}

function normalizedSha256(value, optionName) {
	const normalized = value.startsWith("sha256:") ? value : `sha256:${value}`;
	if (!/^sha256:[a-f0-9]{64}$/u.test(normalized)) {
		throw new Error(`${optionName} must be a lowercase SHA-256 digest`);
	}
	return normalized;
}

function inspectCandidate(path) {
	const expectedDigest = option("--expected-sha256");
	const licensePath = option("--license");
	const expectedLicenseDigest = option("--expected-license-sha256");
	if (!expectedDigest || !licensePath || !expectedLicenseDigest) {
		throw new Error(
			"--candidate requires --expected-sha256, --license, and --expected-license-sha256 for reproducible review",
		);
	}
	const fontBytes = readFileSync(resolve(path));
	const licenseBytes = readFileSync(resolve(licensePath));
	const licenseText = new TextDecoder("utf-8", { fatal: true }).decode(
		licenseBytes,
	);
	const inspection = inspectBytes(fontBytes);
	const actualDigest = inspection.contentDigest;
	const normalizedExpected = normalizedSha256(
		expectedDigest,
		"--expected-sha256",
	);
	const normalizedExpectedLicense = normalizedSha256(
		expectedLicenseDigest,
		"--expected-license-sha256",
	);
	const actualLicenseDigest = `sha256:${sha256(licenseBytes)}`;
	const result = {
		schemaVersion: 1,
		fixture: {
			id: "F01",
			textSha256: sha256(Buffer.from(MOTION_TEXT_F01_RENDERED_TEXT, "utf8")),
		},
		candidate: {
			fontFile: basename(path),
			licenseFile: basename(licensePath),
			expectedDigest: normalizedExpected,
			actualDigest,
			digestMatches: actualDigest === normalizedExpected,
			expectedLicenseDigest: normalizedExpectedLicense,
			actualLicenseDigest,
			licenseDigestMatches: actualLicenseDigest === normalizedExpectedLicense,
			licenseRecognized: licenseText.includes(
				"SIL OPEN FONT LICENSE Version 1.1",
			),
			glyphCount: inspection.glyphCount,
			missingCodePoints: codePointEvidence(inspection.missingCodePoints),
		},
	};
	console.log(JSON.stringify(result, null, "\t"));
	if (
		result.candidate.digestMatches !== true ||
		result.candidate.licenseDigestMatches !== true ||
		result.candidate.licenseRecognized !== true ||
		result.candidate.missingCodePoints.length !== 0 ||
		licenseBytes.byteLength === 0
	) {
		process.exitCode = 1;
	}
}

const candidate = option("--candidate");
if (candidate) {
	if (CHECK_ONLY)
		throw new Error("--candidate and --check are mutually exclusive");
	inspectCandidate(candidate);
} else if (CHECK_ONLY) {
	const actual = strictJson(REPORT_PATH);
	const expected = buildReport();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			"Motion-text font readiness report is stale; regenerate it from the canonical assets",
		);
	}
	console.log(
		`motion-text font readiness: PASS (${actual.summary.uniqueAssets} assets, default missing ${actual.summary.defaultMissingCodePointCount}, full coverage ${actual.summary.fullCoverageAssets.length})`,
	);
} else {
	console.log(JSON.stringify(buildReport(), null, "\t"));
}
