import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

interface FontCatalogEntry {
	readonly id: string;
	readonly roleId?: string;
	readonly family: string;
	readonly style: "normal" | "italic";
	readonly weight: number;
	readonly kind: string;
	readonly supportedLanguages: readonly string[];
	readonly defaultForLanguages?: readonly string[];
	readonly builtinPath: string;
	readonly contentDigest: string;
	readonly license: string;
	readonly licensePath: string;
}

interface FontCatalog {
	readonly schemaVersion: number;
	readonly source: {
		readonly provider: string;
		readonly repository: string;
		readonly revision: string;
	};
	readonly fonts: readonly FontCatalogEntry[];
}

const REPO_ROOT = resolve(import.meta.dir, "../../../../../..");
const PUBLIC_ROOT = resolve(REPO_ROOT, "apps/web/public");
const CATALOG_PATH = resolve(
	REPO_ROOT,
	"rust/crates/motion-text/resources/jizura-font-catalog.json",
);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isFontCatalogEntry(value: unknown): value is FontCatalogEntry {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		(value.roleId === undefined || typeof value.roleId === "string") &&
		typeof value.family === "string" &&
		(value.style === "normal" || value.style === "italic") &&
		typeof value.weight === "number" &&
		typeof value.kind === "string" &&
		Array.isArray(value.supportedLanguages) &&
		value.supportedLanguages.every(
			(language) => typeof language === "string",
		) &&
		(value.defaultForLanguages === undefined ||
			(Array.isArray(value.defaultForLanguages) &&
				value.defaultForLanguages.every(
					(language) => typeof language === "string",
				))) &&
		typeof value.builtinPath === "string" &&
		typeof value.contentDigest === "string" &&
		typeof value.license === "string" &&
		typeof value.licensePath === "string"
	);
}

function isFontCatalog(value: unknown): value is FontCatalog {
	if (!isRecord(value) || !isRecord(value.source)) return false;
	return (
		typeof value.schemaVersion === "number" &&
		typeof value.source.provider === "string" &&
		typeof value.source.repository === "string" &&
		typeof value.source.revision === "string" &&
		Array.isArray(value.fonts) &&
		value.fonts.every(isFontCatalogEntry)
	);
}

function readCatalog(): FontCatalog {
	const source = new TextDecoder("utf-8", { fatal: true }).decode(
		readFileSync(CATALOG_PATH),
	);
	const parsed: unknown = JSON.parse(source);
	if (!isFontCatalog(parsed)) {
		throw new Error("JIZURA font catalog does not match its test contract.");
	}
	return parsed;
}

function sha256(bytes: Uint8Array): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("JIZURA offline font catalog", () => {
	test("pins 23 stable roles and validates every language asset", () => {
		const catalog = readCatalog();
		expect(catalog.schemaVersion).toBe(1);
		expect(catalog.source).toEqual({
			provider: "Google Fonts",
			repository: "https://github.com/google/fonts",
			revision: "23e54b51ddffbc7713c583748e3bd86f62b1fa4a",
		});
		expect(new Set(catalog.fonts.map((font) => font.id)).size).toBe(
			catalog.fonts.length,
		);
		const roleIds = new Set(
			catalog.fonts.map((font) => font.roleId ?? font.id),
		);
		expect(roleIds.size).toBe(23);
		const baseRoleIds = new Set(
			catalog.fonts
				.filter((font) => (font.roleId ?? font.id) === font.id)
				.map((font) => font.id),
		);
		expect(baseRoleIds).toEqual(roleIds);
		const languageDefaults = new Set<string>();

		for (const font of catalog.fonts) {
			for (const language of font.defaultForLanguages ?? []) {
				expect(
					font.supportedLanguages.some(
						(supported) => supported.toLowerCase() === language.toLowerCase(),
					),
					`${font.id} default language ${language}`,
				).toBe(true);
				const key = `${font.roleId ?? font.id}\0${language.toLowerCase()}`;
				expect(languageDefaults.has(key), key).toBe(false);
				languageDefaults.add(key);
			}
			const bytes = new Uint8Array(
				readFileSync(resolve(PUBLIC_ROOT, font.builtinPath)),
			);
			expect(sha256(bytes), font.id).toBe(font.contentDigest);
			expect(font.license).toBe("OFL-1.1");
			const license = new TextDecoder("utf-8", { fatal: true }).decode(
				readFileSync(resolve(PUBLIC_ROOT, font.licensePath)),
			);
			expect(license, font.id).toContain("SIL OPEN FONT LICENSE Version 1.1");
		}
	});
});
