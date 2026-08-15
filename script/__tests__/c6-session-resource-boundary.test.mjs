import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { test, expect } from "bun:test";
import { collectNextEditorModuleIds } from "../collect-next-editor-module-ids.mjs";
import { generateSessionResourceClosureCandidate } from "../generate-session-resource-closure.mjs";

const root = join(import.meta.dir, "..", "..");
const checker = join(root, "script", "check-session-resource-boundary.mjs");

const REVIEWER_EXECUTABLE_NEGATIVES = [
	{
		label: "timer identifier alias",
		rule: "no-direct-timer",
		path: "packages/editor-classic/src/editor/fixture/reviewer-timer-alias.ts",
		text: `export function scheduleNow() {
			{
				const schedule = globalThis.setTimeout;
				return schedule(() => {}, 1);
			}
		}`,
	},
	{
		label: "timer computed property",
		rule: "no-direct-timer",
		path: "packages/editor-classic/src/editor/fixture/reviewer-timer-computed.ts",
		text: 'globalThis["setTimeout"](() => {}, 1);',
	},
	{
		label: "Worker constructor alias",
		rule: "no-direct-worker",
		path: "packages/editor-classic/src/editor/fixture/reviewer-worker-alias.ts",
		text: "const WorkerCtor = Worker; new WorkerCtor(url);",
	},
	{
		label: "AudioContext constructor alias",
		rule: "no-direct-audio",
		path: "packages/editor-classic/src/editor/fixture/reviewer-audio-alias.ts",
		text: "const AudioCtor = AudioContext; new AudioCtor();",
	},
	{
		label: "URL.createObjectURL destructure",
		rule: "no-direct-object-url",
		path: "packages/editor-classic/src/editor/fixture/reviewer-url-destructure.ts",
		text: "const { createObjectURL } = URL; createObjectURL(blob);",
	},
	{
		label: "OfflineAudioContext destructured alias",
		rule: "no-offline-escape",
		path: "packages/editor-classic/src/media/fixture/reviewer-offline-destructure.ts",
		text: `export async function render() {
			const { OfflineAudioContext: OfflineCtor } = globalThis;
			const context = new OfflineCtor(1, 1, 44100);
			return await context.startRendering();
		}`,
	},
	{
		label: "arbitrary single-resource wrapper",
		rule: "no-second-acquisition-mediator",
		path: "packages/editor-classic/src/editor/fixture/reviewer-single-wrapper.ts",
		text: `function arbitrary(resources) {
			return resources.setTimeout({ handler: () => {}, ms: 1 });
		}
		export function expose(resources) {
			return arbitrary(resources);
		}`,
	},
	{
		label: "destructured multi-resource wrapper",
		rule: "no-second-acquisition-mediator",
		path: "packages/editor-classic/src/editor/fixture/reviewer-destructured-wrapper.ts",
		text: `export function broker(resources) {
			const { createWorker: spawn, createAudioContext: open } = resources;
			return { worker: spawn({ request }), audio: open({}) };
		}`,
	},
];

for (const fixture of REVIEWER_EXECUTABLE_NEGATIVES) {
	test(`C6 executable negative rejects ${fixture.label}`, () => {
		const fixtureDir = mkdtempSync(join(tmpdir(), "c6-boundary-source-"));
		try {
			const sourcePath = join(fixtureDir, "fixture.ts");
			writeFileSync(sourcePath, fixture.text);
			const result = spawnSync(
				process.execPath,
				[checker, "--scan-file", fixture.path, sourcePath],
				{
					cwd: root,
					encoding: "utf8",
				},
			);
			const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
			expect(result.status).not.toBe(0);
			expect(output).toContain(`[${fixture.rule}]`);
			expect(output).toContain(fixture.path);
		} finally {
			rmSync(fixtureDir, { recursive: true, force: true });
		}
	});
}

test("C6 resource boundary scans a non-empty inventory and stays clean", () => {
	const output = execFileSync(process.execPath, [checker], {
		cwd: root,
		encoding: "utf8",
	});
	expect(output).toContain("scanned");
	expect(output).toContain("PASS no-direct-timer");
	expect(output).toContain("PASS no-direct-worker");
	expect(output).toContain("PASS no-direct-audio");
	expect(output).toContain("PASS no-direct-object-url");
	expect(output).toContain("PASS no-offline-escape");
	expect(output).toContain("PASS no-unkeyed-compositor");
	expect(output).toContain("PASS no-second-acquisition-mediator");
}, 30_000);

test("C6 resource boundary negative controls prove every rule can fail", () => {
	const output = execFileSync(
		process.execPath,
		[checker, "--negative-control"],
		{
			cwd: root,
			encoding: "utf8",
		},
	);
	expect(output).toContain(
		"C6 session-resource boundary negative controls clean",
	);
	for (const expected of [
		"no-direct-timer @ packages/editor-classic/src/editor/fixture/direct-timer.ts",
		"no-direct-worker @ packages/editor-classic/src/editor/fixture/direct-worker.ts",
		"no-direct-audio @ packages/editor-classic/src/editor/fixture/direct-audio.ts",
		"no-direct-object-url @ packages/editor-classic/src/editor/fixture/direct-object-url.ts",
		"no-offline-escape @ packages/editor-classic/src/editor/fixture/offline-escape.ts",
		"no-unkeyed-compositor @ packages/editor-classic/src/services/renderer/fixture/default-compositor.ts",
		"no-second-acquisition-mediator @ packages/editor-classic/src/editor/session/fixture/second-resource-mediator.ts",
		"truncated-but-nonempty emitted graph control",
		"missing-root emitted graph control",
		"truncated source inventory control",
		"padded required-root closure control",
		"offline constructor-alias escape control",
		"offline container escape control",
		"offline unrelated-finally control",
		"offline storage escape control",
		"offline exported escape control",
		"offline return escape control",
		"offline missing-awaited-render control",
		"offline lifecycle escape control",
		"bounded offline operation positive control",
		"arbitrarily named acquisition mediator control",
		"block-bodied acquisition mediator control",
	]) {
		expect(output).toContain(`PASS ${expected}`);
	}
}, 30_000);

test("C6 Next inventory follows the editor route manifest/NFT and source maps", () => {
	const nextDist = resolve(
		root,
		"apps/web/.next-c6-s52-final3-next-20260804-1",
	);
	if (!existsSync(join(nextDist, "BUILD_ID"))) return;
	const inventory = collectNextEditorModuleIds({
		distDir: nextDist,
		repositoryRoot: root,
	});
	expect(inventory.files.length).toBeGreaterThan(60);
	expect(inventory.mapFiles.length).toBeGreaterThan(10);
	expect(inventory.sourceModuleIds).toContain(
		"apps/web/src/editor/host/next-editor-host.ts",
	);
	expect(inventory.sourceModuleIds).toContain(
		"packages/editor-classic/src/editor/session/create-session.ts",
	);
	for (const requiredRoot of [
		"components/editor",
		"preview",
		"selection",
		"timeline",
		"sounds",
		"export",
		"utils",
		"core",
		"editor",
		"media",
		"retime",
		"services/renderer",
		"services/transcription",
		"services/video-cache",
		"services/waveform-cache",
	]) {
		expect(
			inventory.sourceModuleIds.some((moduleId) =>
				moduleId.startsWith(`packages/editor-classic/src/${requiredRoot}/`),
			),
		).toBe(true);
	}
});

test("C6 emitted boundary accepts fresh Vite and Next outputs when present", () => {
	const viteDist = resolve(
		root,
		"apps/vite-example/dist-c6-s52-final3-vite-20260804-1",
	);
	const nextDist = resolve(
		root,
		"apps/web/.next-c6-s52-final3-next-20260804-1",
	);
	if (!existsSync(join(viteDist, "module-graph.json"))) return;
	if (!existsSync(join(nextDist, "BUILD_ID"))) return;
	const output = execFileSync(process.execPath, [checker], {
		cwd: root,
		encoding: "utf8",
		env: {
			...process.env,
			C6_VITE_DIST: viteDist,
			C6_NEXT_DIST: nextDist,
		},
	});
	expect(output).toContain("PASS emitted vite graph");
	expect(output).toContain("PASS emitted next route");
	expect(output).toContain(
		"exact entries=apps/vite-example/src/host/vite-host-config.ts",
	);
	expect(output).toContain(
		"exact entries=apps/web/src/editor/host/next-editor-host.ts",
	);
	expect(output).toContain("components/editor=expected:24/actual:24");
	expect(output).toContain("preview=expected:25/actual:25");
}, 30_000);

test("C6 independent anchor verifies fresh Vite and Next artifact digests", () => {
	const anchor = JSON.parse(
		readFileSync(
			join(root, "script/fixtures/c6-session-resource-closure-anchor.json"),
			"utf8",
		),
	);
	if (
		!existsSync(resolve(root, anchor.artifacts.vite.moduleGraph)) ||
		!existsSync(resolve(root, anchor.artifacts.next.dist))
	) {
		return;
	}
	const output = execFileSync(
		process.execPath,
		[checker, "--verify-provenance"],
		{
			cwd: root,
			encoding: "utf8",
		},
	);
	expect(output).toContain(
		"PASS anchored closure provenance: Vite 3842 modules/658 web source IDs",
	);
	expect(output).toContain(
		"Next 86 route files/82 maps/3120 module IDs/659 source IDs",
	);
	expect(output).toContain(
		"BUILD_ID is verified provenance metadata and is excluded from the closure payload",
	);
}, 30_000);

test("C6 generator keeps closure stable across distinct Next build IDs", () => {
	const viteDist = resolve(
		root,
		"apps/vite-example/dist-c6-s52-final3-vite-20260804-1",
	);
	const earlierNextDist = resolve(root, "apps/web/.next");
	const reviewedNextDist = resolve(
		root,
		"apps/web/.next-c6-s52-final3-next-20260804-1",
	);
	if (
		!existsSync(join(viteDist, "module-graph.json")) ||
		!existsSync(join(earlierNextDist, "BUILD_ID")) ||
		!existsSync(join(reviewedNextDist, "BUILD_ID"))
	) {
		return;
	}
	const closurePath = join(
		root,
		"script/fixtures/c6-session-resource-expected-closure.json",
	);
	const anchorPath = join(
		root,
		"script/fixtures/c6-session-resource-closure-anchor.json",
	);
	const closureBefore = readFileSync(closurePath, "utf8");
	const anchorBefore = readFileSync(anchorPath, "utf8");
	const earlier = generateSessionResourceClosureCandidate({
		repositoryRoot: root,
		viteDist,
		nextDist: earlierNextDist,
	});
	const reviewed = generateSessionResourceClosureCandidate({
		repositoryRoot: root,
		viteDist,
		nextDist: reviewedNextDist,
	});
	expect(earlier.closure.provenance.next.buildId).not.toBe(
		reviewed.closure.provenance.next.buildId,
	);
	expect(earlier.closure.integrity.canonicalPayloadSha256).toBe(
		reviewed.closure.integrity.canonicalPayloadSha256,
	);
	expect(earlier.closure.common).toEqual(reviewed.closure.common);
	expect(earlier.closure.hosts).toEqual(reviewed.closure.hosts);
	expect(readFileSync(closurePath, "utf8")).toBe(closureBefore);
	expect(readFileSync(anchorPath, "utf8")).toBe(anchorBefore);
}, 30_000);

test("C6 emitted boundary rejects a non-empty truncated Vite graph", () => {
	const fixtureDir = mkdtempSync(join(tmpdir(), "c6-session-boundary-"));
	try {
		const roots = [
			"components/editor",
			"preview",
			"selection",
			"timeline",
			"sounds",
			"export",
			"utils",
			"core",
			"editor",
			"media",
			"retime",
			"services/renderer",
			"services/transcription",
			"services/video-cache",
			"services/waveform-cache",
		];
		const modules = [
			...roots.map(
				(requiredRoot) =>
					`packages/editor-classic/src/${requiredRoot}/truncated.ts`,
			),
			"apps/vite-example/src/host/vite-host-config.ts",
			"packages/editor-classic/src/editor/session/create-session.ts",
		];
		writeFileSync(
			join(fixtureDir, "module-graph.json"),
			JSON.stringify({ modules }),
		);
		const result = (() => {
			try {
				execFileSync(process.execPath, [checker], {
					cwd: root,
					encoding: "utf8",
					stderr: "pipe",
					env: { ...process.env, C6_VITE_DIST: fixtureDir },
				});
				return "";
			} catch (error) {
				return `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
			}
		})();
		expect(result).toContain("C6 emitted vite graph is truncated");
	} finally {
		rmSync(fixtureDir, { recursive: true, force: true });
	}
}, 30_000);

test("C6 emitted boundary rejects a padded graph that truncates each attributable root", () => {
	const fixtureDir = mkdtempSync(join(tmpdir(), "c6-session-boundary-padded-"));
	try {
		const roots = [
			"components/editor",
			"preview",
			"selection",
			"timeline",
			"sounds",
			"export",
			"utils",
			"core",
			"editor",
			"media",
			"retime",
			"services/renderer",
			"services/transcription",
			"services/video-cache",
			"services/waveform-cache",
		];
		const modules = [
			...roots.flatMap((requiredRoot, rootIndex) => [
				`packages/editor-classic/src/${requiredRoot}/only-${rootIndex}.ts`,
				...Array.from(
					{ length: 5 },
					(_, index) =>
						`packages/editor-classic/src/${requiredRoot}/padding-${rootIndex}-${index}.ts`,
				),
			]),
			"apps/vite-example/src/host/vite-host-config.ts",
			"packages/editor-classic/src/editor/session/create-session.ts",
			...Array.from(
				{ length: 80 },
				(_, index) =>
					`packages/editor-classic/src/unmandated/padding-${index}.ts`,
			),
		];
		writeFileSync(
			join(fixtureDir, "module-graph.json"),
			JSON.stringify({ modules }),
		);
		writeFileSync(
			join(fixtureDir, "asset-manifest.json"),
			JSON.stringify({ build: { marker: "c6-padded-truncated-red" } }),
		);
		const result = (() => {
			try {
				execFileSync(process.execPath, [checker], {
					cwd: root,
					encoding: "utf8",
					stderr: "pipe",
					env: { ...process.env, C6_VITE_DIST: fixtureDir },
				});
				return "";
			} catch (error) {
				return `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
			}
		})();
		expect(result).toContain("omitted attributable closure");
		expect(result).toContain("components/editor");
	} finally {
		rmSync(fixtureDir, { recursive: true, force: true });
	}
}, 30_000);

test("C6 closure minimum is anchored independently from a downgraded fixture", () => {
	const fixtureDir = mkdtempSync(join(tmpdir(), "c6-session-boundary-anchor-"));
	try {
		const fixturePath = join(
			root,
			"script",
			"fixtures",
			"c6-session-resource-expected-closure.json",
		);
		const downgraded = JSON.parse(readFileSync(fixturePath, "utf8"));
		downgraded.common = downgraded.requiredRoots.map((requiredRoot) => {
			const source = downgraded.common.find((moduleId) =>
				moduleId.startsWith(`packages/editor-classic/src/${requiredRoot}/`),
			);
			if (!source) throw new Error(`Missing fixture root ${requiredRoot}`);
			return source;
		});
		downgraded.integrity.reviewedCommonSourceCount = downgraded.common.length;
		const canonicalPayload = JSON.stringify({
			requiredRoots: downgraded.requiredRoots,
			common: downgraded.common,
			hosts: downgraded.hosts,
		});
		downgraded.integrity.canonicalPayloadSha256 = createHash("sha256")
			.update(canonicalPayload)
			.digest("hex");
		const downgradedPath = join(fixtureDir, "downgraded-closure.json");
		writeFileSync(downgradedPath, JSON.stringify(downgraded));

		const result = (() => {
			try {
				execFileSync(process.execPath, [checker], {
					cwd: root,
					encoding: "utf8",
					stderr: "pipe",
					env: {
						...process.env,
						C6_EXPECTED_CLOSURE: downgradedPath,
					},
				});
				return "";
			} catch (error) {
				return `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
			}
		})();
		expect(result).toContain("expected closure fixture integrity drifted");
	} finally {
		rmSync(fixtureDir, { recursive: true, force: true });
	}
}, 30_000);

test("C6 checker and closure fixture cannot self-approve a coordinated downgrade", () => {
	const fixtureDir = mkdtempSync(join(tmpdir(), "c6-boundary-cochange-"));
	try {
		const fixturePath = join(
			root,
			"script",
			"fixtures",
			"c6-session-resource-expected-closure.json",
		);
		const downgraded = JSON.parse(readFileSync(fixturePath, "utf8"));
		downgraded.common = downgraded.requiredRoots.map((requiredRoot) => {
			const source = downgraded.common.find((moduleId) =>
				moduleId.startsWith(`packages/editor-classic/src/${requiredRoot}/`),
			);
			if (!source) throw new Error(`Missing fixture root ${requiredRoot}`);
			return source;
		});
		downgraded.integrity.reviewedCommonSourceCount = downgraded.common.length;
		const canonicalPayload = JSON.stringify({
			requiredRoots: downgraded.requiredRoots,
			common: downgraded.common,
			hosts: downgraded.hosts,
		});
		const downgradedDigest = createHash("sha256")
			.update(canonicalPayload)
			.digest("hex");
		downgraded.integrity.canonicalPayloadSha256 = downgradedDigest;
		const downgradedPath = join(fixtureDir, "downgraded-closure.json");
		writeFileSync(downgradedPath, JSON.stringify(downgraded));

		const collectorUrl = pathToFileURL(
			join(root, "script", "collect-next-editor-module-ids.mjs"),
		).href;
		const originalChecker = readFileSync(checker, "utf8");
		const coordinatedChecker = originalChecker
			.replace(
				'const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");',
				`const ROOT = ${JSON.stringify(root)};`,
			)
			.replace(
				'"./collect-next-editor-module-ids.mjs"',
				JSON.stringify(collectorUrl),
			)
			.replace(
				"703efb9c37906b108ff91a8702606ec6a214a4c793476378fd043a94dff20cea",
				downgradedDigest,
			)
			.replace(
				"const EXPECTED_COMMON_SOURCE_COUNT = 272;",
				`const EXPECTED_COMMON_SOURCE_COUNT = ${downgraded.common.length};`,
			);
		const coordinatedCheckerPath = join(fixtureDir, "coordinated-checker.mjs");
		writeFileSync(coordinatedCheckerPath, coordinatedChecker);
		const result = spawnSync(process.execPath, [coordinatedCheckerPath], {
			cwd: root,
			encoding: "utf8",
			env: {
				...process.env,
				C6_EXPECTED_CLOSURE: downgradedPath,
			},
		});
		const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
		expect(result.status).not.toBe(0);
		expect(output).toContain(
			"C6 independent closure anchor rejects the checker/fixture closure",
		);
	} finally {
		rmSync(fixtureDir, { recursive: true, force: true });
	}
}, 30_000);
