import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	recreateOwnedScratchRoot,
	SCRATCH_MARKER_NAME,
} from "../scratch-lifecycle-safety.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..", "..");
const SANDBOX_PARENT = dirname(REPO_ROOT);
const SUITE_ROOT = join(
	SANDBOX_PARENT,
	`opencut-scratch-lifecycle-test-${process.pid}-${randomUUID()}`,
);
const OWNER = "scratch-lifecycle-safety.test.mjs";

function assertSuitePath(path) {
	const rel = relative(SUITE_ROOT, resolve(path)).replace(/\\/g, "/");
	if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"))) return;
	throw new Error(`test path escaped the suite root: ${path}`);
}

function caseParent(name) {
	const path = join(SUITE_ROOT, name);
	assertSuitePath(path);
	mkdirSync(path, { recursive: false });
	return path;
}

function outsideFingerprint(path) {
	return `${existsSync(path)}:${readFileSync(join(path, "do-not-touch.txt"), "utf8")}`;
}

function createOutside(name) {
	const path = join(SUITE_ROOT, name);
	assertSuitePath(path);
	mkdirSync(path, { recursive: false });
	writeFileSync(join(path, "do-not-touch.txt"), `outside:${name}\n`);
	return { path, fingerprint: outsideFingerprint(path) };
}

function expectOutsideUntouched(outside) {
	expect(outsideFingerprint(outside.path)).toBe(outside.fingerprint);
}

function linkDirectory(target, path) {
	symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
}

beforeAll(() => {
	const rel = relative(SANDBOX_PARENT, SUITE_ROOT).replace(/\\/g, "/");
	if (rel.startsWith("..") || rel.startsWith("/") || rel === "") {
		throw new Error(`unsafe lifecycle test root: ${SUITE_ROOT}`);
	}
	mkdirSync(SUITE_ROOT, { recursive: false });
});

afterAll(() => {
	assertSuitePath(SUITE_ROOT);
	rmSync(SUITE_ROOT, { recursive: true, force: true });
});

describe("marker-owned scratch lifecycle safety", () => {
	test("creates and replaces only the exact authenticated tree", () => {
		const parent = caseParent("owned-rerun");
		const root = join(parent, "scratch");
		const logs = [];
		recreateOwnedScratchRoot({
			root,
			createdBy: OWNER,
			log: (line) => logs.push(line),
		});
		writeFileSync(join(root, "old-run.txt"), "disposable\n");

		recreateOwnedScratchRoot({
			root,
			createdBy: OWNER,
			log: (line) => logs.push(line),
		});

		expect(existsSync(join(root, "old-run.txt"))).toBe(false);
		const marker = JSON.parse(
			readFileSync(join(root, SCRATCH_MARKER_NAME), "utf8"),
		);
		expect(marker).toMatchObject({
			schemaVersion: 1,
			createdBy: OWNER,
			rootPath: root,
		});
		expect(logs).toContain(
			"lifecycle: previous scratch root moved to an authenticated quarantine",
		);
		expect(logs).toContain(
			"lifecycle: authenticated previous scratch root removed",
		);
	});

	test("refuses a foreign owner and a marker copied to another root", () => {
		const parent = caseParent("marker-ownership");
		const owned = join(parent, "owned");
		recreateOwnedScratchRoot({ root: owned, createdBy: OWNER });
		writeFileSync(join(owned, "owner-sentinel.txt"), "keep\n");

		expect(() =>
			recreateOwnedScratchRoot({ root: owned, createdBy: "another-runner" }),
		).toThrow(/owner mismatch/);
		expect(readFileSync(join(owned, "owner-sentinel.txt"), "utf8")).toBe(
			"keep\n",
		);

		const copied = join(parent, "copied");
		mkdirSync(copied, { recursive: false });
		cpSync(join(owned, SCRATCH_MARKER_NAME), join(copied, SCRATCH_MARKER_NAME));
		writeFileSync(join(copied, "copied-sentinel.txt"), "keep copied\n");
		expect(() =>
			recreateOwnedScratchRoot({ root: copied, createdBy: OWNER }),
		).toThrow(/rootPath does not own|tree identity does not match/);
		expect(readFileSync(join(copied, "copied-sentinel.txt"), "utf8")).toBe(
			"keep copied\n",
		);
	});

	test("refuses a parent identity swap before the forward rename", () => {
		const parent = caseParent("parent-swap");
		const ownedParent = join(parent, "owned-parent");
		mkdirSync(ownedParent, { recursive: false });
		const root = join(ownedParent, "scratch");
		recreateOwnedScratchRoot({ root, createdBy: OWNER });
		const outside = createOutside("parent-swap-outside");
		const parkedParent = join(parent, "parked-parent");

		expect(() =>
			recreateOwnedScratchRoot({
				root,
				createdBy: OWNER,
				hooks: {
					beforeRename() {
						renameSync(ownedParent, parkedParent);
						mkdirSync(ownedParent, { recursive: false });
					},
				},
			}),
		).toThrow(/parent physical identity changed/);
		expectOutsideUntouched(outside);
		rmSync(ownedParent, { recursive: true, force: false });
		renameSync(parkedParent, ownedParent);
	});

	test("refuses a redirected canonical root before the forward rename", () => {
		const parent = caseParent("root-redirection");
		const root = join(parent, "scratch");
		const parkedRoot = join(parent, "parked-root");
		const outside = createOutside("root-redirection-outside");
		recreateOwnedScratchRoot({ root, createdBy: OWNER });

		expect(() =>
			recreateOwnedScratchRoot({
				root,
				createdBy: OWNER,
				hooks: {
					beforeRename() {
						renameSync(root, parkedRoot);
						linkDirectory(outside.path, root);
					},
				},
			}),
		).toThrow(/scratch root is not a plain directory/);
		expectOutsideUntouched(outside);
		unlinkSync(root);
		renameSync(parkedRoot, root);
	});

	test("refuses a copied-marker directory swap before the first quarantine capture", () => {
		const parent = caseParent("post-rename-swap");
		const root = join(parent, "scratch");
		const parked = join(parent, "parked-authenticated-tree");
		let replacement;
		recreateOwnedScratchRoot({ root, createdBy: OWNER });

		expect(() =>
			recreateOwnedScratchRoot({
				root,
				createdBy: OWNER,
				hooks: {
					afterRenameBeforeCapture({ quarantine }) {
						renameSync(quarantine, parked);
						mkdirSync(quarantine, { recursive: false });
						cpSync(
							join(parked, SCRATCH_MARKER_NAME),
							join(quarantine, SCRATCH_MARKER_NAME),
						);
						writeFileSync(
							join(quarantine, "replacement-sentinel.txt"),
							"do not delete\n",
						);
						replacement = quarantine;
					},
				},
			}),
		).toThrow(/physical identity changed after rename/);
		expect(existsSync(root)).toBe(false);
		expect(existsSync(parked)).toBe(true);
		expect(
			readFileSync(join(replacement, "replacement-sentinel.txt"), "utf8"),
		).toBe("do not delete\n");
		expect(existsSync(join(replacement, SCRATCH_MARKER_NAME))).toBe(true);
	});

	test("refuses redirected quarantine cleanup and reports truthful residue", () => {
		const parent = caseParent("cleanup-redirection");
		const root = join(parent, "scratch");
		const parked = join(parent, "authenticated-residue");
		const outside = createOutside("cleanup-redirection-outside");
		let quarantineLink;
		recreateOwnedScratchRoot({ root, createdBy: OWNER });

		expect(() =>
			recreateOwnedScratchRoot({
				root,
				createdBy: OWNER,
				hooks: {
					beforeCleanup({ quarantine }) {
						quarantineLink = quarantine;
						renameSync(quarantine, parked);
						linkDirectory(outside.path, quarantine);
					},
				},
			}),
		).toThrow(/scratch root is not a plain directory/);
		expect(existsSync(root)).toBe(false);
		expect(existsSync(parked)).toBe(true);
		expectOutsideUntouched(outside);
		expect(quarantineLink).toBeDefined();
		unlinkSync(quarantineLink);
		renameSync(parked, root);
	});

	test("re-inspects and reports authenticated residue after partial cleanup failure", () => {
		const parent = caseParent("partial-cleanup-failure");
		const root = join(parent, "scratch");
		let quarantinePath;
		recreateOwnedScratchRoot({ root, createdBy: OWNER });
		writeFileSync(join(root, "removed-before-failure.txt"), "remove first\n");
		writeFileSync(join(root, "retained-after-failure.txt"), "retain\n");

		expect(() =>
			recreateOwnedScratchRoot({
				root,
				createdBy: OWNER,
				hooks: {
					cleanupQuarantine({ quarantine }) {
						quarantinePath = quarantine;
						unlinkSync(join(quarantine, "removed-before-failure.txt"));
						throw new Error("injected partial cleanup failure");
					},
				},
			}),
		).toThrow(
			/scratch cleanup failed; canonical root is absent; authenticated quarantine residue remains/,
		);
		expect(existsSync(root)).toBe(false);
		expect(existsSync(quarantinePath)).toBe(true);
		expect(existsSync(join(quarantinePath, "removed-before-failure.txt"))).toBe(
			false,
		);
		expect(
			readFileSync(join(quarantinePath, "retained-after-failure.txt"), "utf8"),
		).toBe("retain\n");
		const marker = JSON.parse(
			readFileSync(join(quarantinePath, SCRATCH_MARKER_NAME), "utf8"),
		);
		expect(marker.createdBy).toBe(OWNER);
		expect(marker.rootPath).toBe(root);
	});
});
