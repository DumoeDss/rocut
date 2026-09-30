import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";

const FONT_PATH = /^motion-text\/fonts\/[a-z0-9][a-z0-9-]*\.ttf$/u;
const LICENSE_PATH =
	/^motion-text\/fonts\/licenses\/[a-z0-9][a-z0-9-]*-OFL\.txt$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value, key, context) {
	const field = value[key];
	if (typeof field !== "string" || field.length === 0) {
		throw new TypeError(`${context}.${key} must be a non-empty string.`);
	}
	return field;
}

function optionalStringArray(value, key, context) {
	const field = value[key] ?? [];
	if (
		!Array.isArray(field) ||
		!field.every((entry) => typeof entry === "string" && entry.length > 0) ||
		new Set(field.map((entry) => entry.toLowerCase())).size !== field.length
	) {
		throw new TypeError(
			`${context}.${key} must contain unique, non-empty language tags.`,
		);
	}
	return field;
}

function strictUtf8(path) {
	const bytes = readFileSync(path);
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xef &&
		bytes[1] === 0xbb &&
		bytes[2] === 0xbf
	) {
		throw new Error(`${path} must be UTF-8 without a BOM.`);
	}
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function resolveLogicalAsset(publicRoot, logicalPath, context) {
	const root = resolve(publicRoot);
	const path = resolve(root, logicalPath);
	if (!path.startsWith(`${root}${sep}`)) {
		throw new Error(`${context} escapes the public asset root.`);
	}
	return path;
}

function assertExactClosure(actual, expected, context) {
	const actualNames = [...actual].sort();
	const expectedNames = [...expected].sort();
	if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
		throw new Error(
			`${context} does not match the font catalog: expected ${expectedNames.join(", ")}; found ${actualNames.join(", ")}.`,
		);
	}
}

export function inspectMotionTextFontInventory({ catalogPath, publicRoot }) {
	const catalog = JSON.parse(strictUtf8(catalogPath));
	if (
		!isRecord(catalog) ||
		catalog.schemaVersion !== 1 ||
		!isRecord(catalog.source) ||
		!Array.isArray(catalog.fonts)
	) {
		throw new TypeError(
			"The motion-text font catalog must use schema version 1.",
		);
	}

	const source = {
		provider: requiredString(catalog.source, "provider", "catalog.source"),
		repository: requiredString(catalog.source, "repository", "catalog.source"),
		revision: requiredString(catalog.source, "revision", "catalog.source"),
	};
	const ids = new Set();
	const roles = new Set();
	const baseRoles = new Set();
	const languages = new Set();
	const languageDefaults = new Set();
	const licenseSources = new Set();
	const assets = new Map();
	const licenses = new Map();

	for (const [index, rawFont] of catalog.fonts.entries()) {
		const context = `catalog.fonts[${index}]`;
		if (!isRecord(rawFont)) {
			throw new TypeError(`${context} must be an object.`);
		}
		const id = requiredString(rawFont, "id", context);
		if (ids.has(id)) throw new Error(`Duplicate font asset id ${id}.`);
		ids.add(id);
		const roleId = rawFont.roleId ?? id;
		if (typeof roleId !== "string" || roleId.length === 0) {
			throw new TypeError(`${context}.roleId must be a non-empty string.`);
		}
		roles.add(roleId);
		if (id === roleId) baseRoles.add(roleId);

		const supportedLanguages = optionalStringArray(
			rawFont,
			"supportedLanguages",
			context,
		);
		const defaultForLanguages = optionalStringArray(
			rawFont,
			"defaultForLanguages",
			context,
		);
		for (const language of supportedLanguages) languages.add(language);
		for (const language of defaultForLanguages) {
			if (
				!supportedLanguages.some(
					(supported) => supported.toLowerCase() === language.toLowerCase(),
				)
			) {
				throw new Error(
					`${context}.defaultForLanguages contains unsupported language ${language}.`,
				);
			}
			const key = `${roleId}\0${language.toLowerCase()}`;
			if (languageDefaults.has(key)) {
				throw new Error(
					`Duplicate default asset for role ${roleId} and language ${language}.`,
				);
			}
			languageDefaults.add(key);
		}

		const builtinPath = requiredString(rawFont, "builtinPath", context);
		if (!FONT_PATH.test(builtinPath)) {
			throw new Error(`${context}.builtinPath must be a logical TTF asset.`);
		}
		const contentDigest = requiredString(rawFont, "contentDigest", context);
		if (!SHA256.test(contentDigest)) {
			throw new Error(`${context}.contentDigest must be a SHA-256 digest.`);
		}
		const assetPath = resolveLogicalAsset(
			publicRoot,
			builtinPath,
			`${context}.builtinPath`,
		);
		const assetBytes = readFileSync(assetPath);
		const actualDigest = `sha256:${createHash("sha256")
			.update(assetBytes)
			.digest("hex")}`;
		if (actualDigest !== contentDigest) {
			throw new Error(
				`${context} digest mismatch: expected ${contentDigest}, received ${actualDigest}.`,
			);
		}
		const existingAsset = assets.get(builtinPath);
		if (existingAsset && existingAsset.contentDigest !== contentDigest) {
			throw new Error(`${builtinPath} has conflicting catalog digests.`);
		}
		assets.set(builtinPath, {
			bytes: assetBytes.byteLength,
			contentDigest,
		});

		const licensePath = requiredString(rawFont, "licensePath", context);
		if (!LICENSE_PATH.test(licensePath)) {
			throw new Error(`${context}.licensePath must be an OFL inventory asset.`);
		}
		if (requiredString(rawFont, "license", context) !== "OFL-1.1") {
			throw new Error(`${context}.license must be OFL-1.1.`);
		}
		const resolvedLicensePath = resolveLogicalAsset(
			publicRoot,
			licensePath,
			`${context}.licensePath`,
		);
		const licenseText = strictUtf8(resolvedLicensePath);
		if (!licenseText.includes("SIL OPEN FONT LICENSE Version 1.1")) {
			throw new Error(`${context} license is not an OFL 1.1 text.`);
		}
		licenses.set(licensePath, {
			bytes: statSync(resolvedLicensePath).size,
		});
		if (rawFont.licenseSource !== undefined) {
			licenseSources.add(requiredString(rawFont, "licenseSource", context));
		}
	}

	for (const roleId of roles) {
		if (!baseRoles.has(roleId)) {
			throw new Error(`Font role ${roleId} has no stable base asset.`);
		}
	}

	const fontRoot = resolve(publicRoot, "motion-text/fonts");
	assertExactClosure(
		readdirSync(fontRoot, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".ttf"))
			.map((entry) => entry.name),
		[...assets.keys()].map((path) => basename(path)),
		"Motion-text TTF closure",
	);
	const licenseRoot = resolve(fontRoot, "licenses");
	assertExactClosure(
		readdirSync(licenseRoot, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith("-OFL.txt"))
			.map((entry) => entry.name),
		[...licenses.keys()].map((path) => basename(path)),
		"Motion-text font-license closure",
	);

	const assetBytes = [...assets.values()].reduce(
		(total, asset) => total + asset.bytes,
		0,
	);
	const licenseBytes = [...licenses.values()].reduce(
		(total, license) => total + license.bytes,
		0,
	);
	return {
		source,
		catalogEntries: catalog.fonts.length,
		roles: roles.size,
		assets: assets.size,
		assetBytes,
		licenses: licenses.size,
		licenseBytes,
		closureBytes: assetBytes + licenseBytes,
		languages: [...languages].sort(),
		languageDefaults: languageDefaults.size,
		licenseSources: [...licenseSources].sort(),
	};
}

export function renderMotionTextFontProvenance(inventory) {
	const number = new Intl.NumberFormat("en-US");
	const variantCount = inventory.catalogEntries - inventory.roles;
	const variants =
		variantCount === 0
			? ""
			: ` plus ${number.format(variantCount)} language-specific asset ${variantCount === 1 ? "entry" : "entries"}`;
	const additionalLicenseSources =
		inventory.licenseSources.length === 0
			? ""
			: ` Additional license provenance is pinned to ${inventory.licenseSources
					.map((source) => `\`${source}\``)
					.join(", ")}.`;
	return `${number.format(inventory.assets)} digest-pinned offline TTFs serve ${number.format(inventory.roles)} stable JIZURA font roles${variants} (${number.format(inventory.assetBytes)} font bytes; ${number.format(inventory.closureBytes)} bytes including ${number.format(inventory.licenses)} notices). ${inventory.source.provider} sources are pinned at revision \`${inventory.source.revision}\`.${additionalLicenseSources} Each family ships its SIL OFL 1.1 text beside the assets. Catalog-declared language tags: ${inventory.languages.map((language) => `\`${language}\``).join(", ")}; these tags do not replace per-text glyph checks.`;
}
