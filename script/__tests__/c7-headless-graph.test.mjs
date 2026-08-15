import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	canonicalHeadlessModuleDigest,
	canonicalHeadlessOutputDigest,
	checkHeadlessGraphEnvelope,
} from "../check-headless-graph.mjs";

const temporaryRoots = [];
const temp = mkdtempSync(join(tmpdir(), "opencut-c7-graph-"));
temporaryRoots.push(temp);
const outputFile = join(temp, "headless.js");
const outputText = "export const headless = true;\n";
const htmlText =
	'<!doctype html><script type="module" src="./headless.js"></script>\n';
writeFileSync(outputFile, outputText);
writeFileSync(join(temp, "headless.html"), htmlText);

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

const outputSha256 = sha256(outputText);
const htmlSha256 = sha256(htmlText);

afterAll(() => {
	for (const root of temporaryRoots) {
		rmSync(root, { recursive: true, force: true });
	}
});

const HEAD = "a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf";
const TREE = "885d307814260b77397c2c2677b9361fdfc5f5e2";

const required = [
	"apps/vite-example/src/headless-entry.ts",
	"packages/editor-classic/src/editor/session/headless-runtime-probe.ts",
	"packages/editor-classic/src/editor/session/headless-semantic-fixture.ts",
	"packages/editor-classic/src/editor/session/headless.ts",
	"packages/editor-classic/src/editor/session/migration-gate.ts",
	"packages/editor-classic/src/editor/persistence/session-persistence-coordinator.ts",
	"packages/editor-classic/src/editor/persistence/project-codec.ts",
	"packages/editor-classic/src/editor/persistence/opaque-value.ts",
	"packages/editor-ports/src/host/index.ts",
	"packages/editor-ports/src/project-store.ts",
	"packages/editor-ports/src/in-memory/index.ts",
	"packages/editor-ports/src/in-memory/host.ts",
];

function validEnvelope() {
	const modules = required.map((id) => ({
		id,
		rawIds: [id],
		chunks: ["headless.js"],
	}));
	const files = [
		{ path: "headless.html", sha256: htmlSha256 },
		{ path: "headless.js", sha256: outputSha256 },
	];
	return {
		schemaVersion: 1,
		producer: "vite-rollup",
		host: "vite",
		entry: {
			expected: required[0],
			observed: required[0],
			matchCount: 1,
			emitted: true,
		},
		acceptedBase: { head: HEAD, tree: TREE },
		build: {
			marker: "c7-vite-clean",
			id: "vite:c7-vite-clean",
			mode: "vite-production",
		},
		attribution: {
			strategy: "rollup-entry-outgoing-closure",
			exactRoot: true,
			dependencyEdges: true,
			emittedIntersection: true,
		},
		output: {
			root: "unused-in-test",
			files,
			fileSetSha256: canonicalHeadlessOutputDigest(files),
			facade: {
				path: "headless.html",
				sha256: htmlSha256,
				scripts: [
					{
						src: "./headless.js",
						type: "module",
						outputPath: "headless.js",
					},
				],
				entryChunks: ["headless.js"],
			},
		},
		modules: {
			count: modules.length,
			items: modules,
			moduleSetSha256: canonicalHeadlessModuleDigest(modules),
		},
	};
}

function check(envelope, overrides = {}) {
	return checkHeadlessGraphEnvelope(envelope, {
		host: "vite",
		producer: "vite-rollup",
		entry: required[0],
		marker: "c7-vite-clean",
		acceptedHead: HEAD,
		acceptedTree: TREE,
		outputRoot: temp,
		...overrides,
	});
}

describe("C7 attributable emitted headless graph", () => {
	test("accepts a complete exact-entry emitted closure", () => {
		expect(check(validEnvelope())).toMatchObject({
			host: "vite",
			moduleCount: required.length,
			forbiddenCount: 0,
		});
	});

	test("rejects a Vite artifact whose executable HTML facade is absent", () => {
		const copiedOutput = mkdtempSync(
			join(tmpdir(), "opencut-c7-graph-missing-html-"),
		);
		temporaryRoots.push(copiedOutput);
		writeFileSync(join(copiedOutput, "headless.js"), outputText);
		const envelope = validEnvelope();
		envelope.output.files = envelope.output.files.filter(
			(file) => file.path !== "headless.html",
		);
		envelope.output.fileSetSha256 = canonicalHeadlessOutputDigest(
			envelope.output.files,
		);
		delete envelope.output.facade;
		expect(() => check(envelope, { outputRoot: copiedOutput })).toThrow(
			/html.*facade|facade.*html/i,
		);
	});

	test("rejects an altered executable HTML facade", () => {
		const alteredOutput = mkdtempSync(
			join(tmpdir(), "opencut-c7-graph-altered-html-"),
		);
		temporaryRoots.push(alteredOutput);
		writeFileSync(join(alteredOutput, "headless.js"), outputText);
		writeFileSync(
			join(alteredOutput, "headless.html"),
			`${htmlText}<!-- altered after collection -->\n`,
		);
		expect(() => check(validEnvelope(), { outputRoot: alteredOutput })).toThrow(
			/file digest changed.*headless\.html/i,
		);
	});

	test("rejects HTML whose module script targets a non-entry chunk", () => {
		const wrongOutput = mkdtempSync(
			join(tmpdir(), "opencut-c7-graph-wrong-script-"),
		);
		temporaryRoots.push(wrongOutput);
		const wrongScript = "export const wrong = true;\n";
		const wrongHtml =
			'<!doctype html><script type="module" src="./wrong.js"></script>\n';
		writeFileSync(join(wrongOutput, "headless.js"), outputText);
		writeFileSync(join(wrongOutput, "wrong.js"), wrongScript);
		writeFileSync(join(wrongOutput, "headless.html"), wrongHtml);
		const envelope = validEnvelope();
		envelope.output.files = [
			{ path: "headless.html", sha256: sha256(wrongHtml) },
			{ path: "headless.js", sha256: outputSha256 },
			{ path: "wrong.js", sha256: sha256(wrongScript) },
		];
		envelope.output.fileSetSha256 = canonicalHeadlessOutputDigest(
			envelope.output.files,
		);
		envelope.output.facade = {
			path: "headless.html",
			sha256: sha256(wrongHtml),
			scripts: [{ src: "./wrong.js", type: "module", outputPath: "wrong.js" }],
			entryChunks: ["headless.js"],
		};
		expect(() => check(envelope, { outputRoot: wrongOutput })).toThrow(
			/module script linked.*exact entry chunk/i,
		);
	});

	for (const [label, mutate, diagnostic] of [
		["empty modules", (value) => (value.modules.items = []), "empty"],
		[
			"wrong entry",
			(value) => (value.entry.observed = "apps/vite-example/src/main.tsx"),
			"entry",
		],
		[
			"missing critical root",
			(value) => value.modules.items.splice(3, 1),
			"required root",
		],
		["stale marker", (value) => (value.build.marker = "stale"), "marker"],
		[
			"stale base",
			(value) => (value.acceptedBase.head = "0".repeat(40)),
			"HEAD",
		],
		[
			"altered file digest",
			(value) => (value.output.files[0].sha256 = "0".repeat(64)),
			"file digest",
		],
		["copied Host graph", (value) => (value.host = "next"), "Host"],
		[
			"aggregate-only inventory",
			(value) => (value.attribution.dependencyEdges = false),
			"dependency",
		],
	]) {
		test(`rejects ${label}`, () => {
			const envelope = validEnvelope();
			mutate(envelope);
			expect(() => check(envelope)).toThrow(new RegExp(diagnostic, "i"));
		});
	}

	for (const [label, id, rawIds = [id]] of [
		["POSIX React", "node_modules/react/index.js"],
		["Windows React DOM", "node_modules\\react-dom\\client.js?worker"],
		[
			"package-manager JSX runtime",
			"node_modules/.bun/react@19.1.1/node_modules/react/jsx-runtime.js#x",
		],
		["virtual React", "\0virtual:react-dom/client"],
		["raw alias", "apps/example/react-control.js", ["react"]],
		["Sonner UI", "node_modules/sonner/dist/index.mjs"],
	]) {
		test(`detects ${label}`, () => {
			const envelope = validEnvelope();
			envelope.modules.items.push({ id, rawIds, chunks: ["headless.js"] });
			envelope.modules.count = envelope.modules.items.length;
			envelope.modules.moduleSetSha256 = canonicalHeadlessModuleDigest(
				envelope.modules.items,
			);
			expect(() => check(envelope)).toThrow(/react-family|sonner/i);
		});
	}

	test("publishes stable structured failure evidence with rule and graph IDs", () => {
		const envelope = validEnvelope();
		const reactId = "node_modules/react/index.js?c7-control";
		envelope.modules.items.push({
			id: reactId,
			rawIds: [reactId],
			chunks: ["headless.js"],
		});
		envelope.modules.count = envelope.modules.items.length;
		envelope.modules.moduleSetSha256 = canonicalHeadlessModuleDigest(
			envelope.modules.items,
		);

		try {
			check(envelope);
			throw new Error("expected C7 graph rejection");
		} catch (error) {
			expect(error.report).toMatchObject({
				schemaVersion: 1,
				ok: false,
				host: "vite",
				exitCode: 1,
				issues: [
					{
						rule: "forbidden.react-family",
						moduleId: reactId,
					},
				],
			});
			expect(error.report.graphSha256).toMatch(/^[0-9a-f]{64}$/);
		}
	});
});
