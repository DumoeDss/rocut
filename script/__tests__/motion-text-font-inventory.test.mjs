import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
	inspectMotionTextFontInventory,
	renderMotionTextFontProvenance,
} from "../motion-text-font-inventory.mjs";

const REPO_ROOT = join(import.meta.dir, "../..");
const CURRENT_CATALOG = join(
	REPO_ROOT,
	"rust/crates/motion-text/resources/jizura-font-catalog.json",
);
const CURRENT_PUBLIC_ROOT = join(REPO_ROOT, "apps/web/public");
const OFL = "SIL OPEN FONT LICENSE Version 1.1\nfixture\n";

function sha256(bytes) {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function withCatalog(fonts, run) {
	const root = mkdtempSync(join(tmpdir(), "rocut-font-inventory-"));
	try {
		const publicRoot = join(root, "public");
		const fontRoot = join(publicRoot, "motion-text/fonts");
		const licenseRoot = join(fontRoot, "licenses");
		mkdirSync(licenseRoot, { recursive: true });
		const hydrated = fonts.map((font) => {
			const bytes = Buffer.from(`font:${font.id}`);
			writeFileSync(join(publicRoot, font.builtinPath), bytes);
			writeFileSync(join(publicRoot, font.licensePath), OFL);
			return { ...font, contentDigest: sha256(bytes) };
		});
		const catalogPath = join(root, "catalog.json");
		writeFileSync(
			catalogPath,
			`${JSON.stringify(
				{
					schemaVersion: 1,
					source: {
						provider: "Fixture Fonts",
						repository: "https://example.invalid/fonts",
						revision: "fixture-revision",
					},
					fonts: hydrated,
				},
				null,
				2,
			)}\n`,
			"utf8",
		);
		return run({ catalogPath, publicRoot });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function font(overrides) {
	return {
		id: "gothic_bold",
		family: "Fixture Sans",
		style: "normal",
		weight: 700,
		kind: "gothic",
		supportedLanguages: ["ja", "en"],
		builtinPath: "motion-text/fonts/base.ttf",
		sourceDirectory: "fixture",
		sourceFile: "base.ttf",
		license: "OFL-1.1",
		licensePath: "motion-text/fonts/licenses/fixture-OFL.txt",
		...overrides,
	};
}

describe("motion-text font inventory", () => {
	test("derives the current SBOM counts from the catalog and asset closure", () => {
		const inventory = inspectMotionTextFontInventory({
			catalogPath: CURRENT_CATALOG,
			publicRoot: CURRENT_PUBLIC_ROOT,
		});
		expect(inventory.catalogEntries).toBe(25);
		expect(inventory.roles).toBe(23);
		expect(inventory.assets).toBe(20);
		expect(inventory.assetBytes).toBe(127_869_668);
		expect(inventory.licenses).toBe(20);
		expect(inventory.licenseBytes).toBe(88_369);
		expect(inventory.closureBytes).toBe(127_958_037);
		expect(inventory.languageDefaults).toBe(2);
		expect(inventory.languages).toEqual(["en", "ja", "ko", "zh-Hans"]);
		expect(renderMotionTextFontProvenance(inventory)).toContain(
			"20 digest-pinned offline TTFs serve 23 stable JIZURA font roles plus 2 language-specific asset entries",
		);
	});

	test("wires font supply-chain gates between install and installed-WASM checks", () => {
		const manifest = JSON.parse(
			readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
		);
		expect(manifest.scripts?.["check:sbom"]).toBe(
			"node script/generate-sbom.mjs --check",
		);
		const workflow = readFileSync(
			join(REPO_ROOT, ".github/workflows/bun-ci.yml"),
			"utf8",
		);
		const installAt = workflow.indexOf("- name: Install dependencies");
		const checkAt = workflow.indexOf(
			"run: node script/generate-sbom.mjs --check",
		);
		const readinessAt = workflow.indexOf("bun run check:motion-text:fonts");
		const focusedTestsAt = workflow.indexOf(
			"bun test script/__tests__/motion-text-font-inventory.test.mjs",
		);
		const installedWasmAt = workflow.indexOf(
			"- name: Verify the resolved wasm is the self-built artifact",
		);
		expect(installAt).toBeGreaterThan(-1);
		expect(checkAt).toBeGreaterThan(installAt);
		expect(readinessAt).toBeGreaterThan(checkAt);
		expect(focusedTestsAt).toBeGreaterThan(readinessAt);
		expect(installedWasmAt).toBeGreaterThan(focusedTestsAt);
	});

	test("counts a language asset separately without inventing a new role", () => {
		withCatalog(
			[
				font(),
				font({
					id: "gothic_bold_zh_hans",
					roleId: "gothic_bold",
					supportedLanguages: ["zh-Hans", "en"],
					defaultForLanguages: ["zh-Hans"],
					builtinPath: "motion-text/fonts/sc.ttf",
					sourceFile: "sc.ttf",
				}),
			],
			({ catalogPath, publicRoot }) => {
				const inventory = inspectMotionTextFontInventory({
					catalogPath,
					publicRoot,
				});
				expect(inventory.catalogEntries).toBe(2);
				expect(inventory.roles).toBe(1);
				expect(inventory.assets).toBe(2);
				expect(inventory.languageDefaults).toBe(1);
				expect(inventory.languages).toEqual(["en", "ja", "zh-Hans"]);
				expect(renderMotionTextFontProvenance(inventory)).toContain(
					"plus 1 language-specific asset entry",
				);
			},
		);
	});

	test("rejects an untracked font file in the shipped closure", () => {
		expect(() =>
			withCatalog([font()], ({ catalogPath, publicRoot }) => {
				writeFileSync(
					join(publicRoot, "motion-text/fonts/orphan.ttf"),
					"orphan",
				);
				return inspectMotionTextFontInventory({ catalogPath, publicRoot });
			}),
		).toThrow("Motion-text TTF closure does not match the font catalog");
	});

	test("rejects ambiguous language defaults for a role", () => {
		expect(() =>
			withCatalog(
				[
					font(),
					font({
						id: "gothic_bold_sc_a",
						roleId: "gothic_bold",
						supportedLanguages: ["zh-Hans"],
						defaultForLanguages: ["zh-Hans"],
						builtinPath: "motion-text/fonts/sc-a.ttf",
						sourceFile: "sc-a.ttf",
					}),
					font({
						id: "gothic_bold_sc_b",
						roleId: "gothic_bold",
						supportedLanguages: ["zh-Hans"],
						defaultForLanguages: ["zh-Hans"],
						builtinPath: "motion-text/fonts/sc-b.ttf",
						sourceFile: "sc-b.ttf",
					}),
				],
				({ catalogPath, publicRoot }) =>
					inspectMotionTextFontInventory({ catalogPath, publicRoot }),
			),
		).toThrow("Duplicate default asset for role gothic_bold");
	});
});
