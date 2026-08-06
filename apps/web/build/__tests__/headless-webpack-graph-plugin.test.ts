import { afterAll, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HeadlessWebpackGraphPlugin } from "../headless-webpack-graph-plugin";
import { checkHeadlessGraphEnvelope } from "../../../../script/check-headless-graph.mjs";

const temporaryRoots: string[] = [];
const ENTRY = "apps/web/src/app/c7-headless/route.ts";
const REQUIRED_RESOURCES = [
	"apps/web/src/editor/session/headless-runtime-probe.ts",
	"apps/web/src/editor/session/headless-semantic-fixture.ts",
	"apps/web/src/editor/session/headless.ts",
	"apps/web/src/editor/session/migration-gate.ts",
	"apps/web/src/editor/persistence/session-persistence-coordinator.ts",
	"apps/web/src/editor/persistence/project-codec.ts",
	"apps/web/src/editor/persistence/opaque-value.ts",
	"apps/web/src/editor/host/editor-host.ts",
	"apps/web/src/editor/ports/project-store.ts",
	"apps/web/src/editor/ports/in-memory/index.ts",
	"apps/web/src/editor/ports/in-memory/host.ts",
];

afterAll(() => {
	for (const root of temporaryRoots) {
		rmSync(root, { recursive: true, force: true });
	}
});

async function runGraphScenario({
	concatenated = false,
	rootHasResource = true,
	rootRawRequest,
	requiredResources = [],
	rootFiles = [],
	entrypointFiles = ["app/c7-headless/route.js"],
	writtenFiles = [...new Set([...rootFiles, ...entrypointFiles])],
}: {
	concatenated?: boolean;
	rootHasResource?: boolean;
	rootRawRequest?: string;
	requiredResources?: string[];
	rootFiles?: string[];
	entrypointFiles?: string[];
	writtenFiles?: string[];
} = {}): Promise<{
	envelope: Record<string, unknown>;
	repoRoot: string;
}> {
	const repoRoot = mkdtempSync(join(tmpdir(), "opencut-c7-next-graph-"));
	temporaryRoots.push(repoRoot);
	const outputRoot = join(repoRoot, "out");
	const compilerOutput = join(outputRoot, "server");
	for (const file of writtenFiles) {
		const absolute = join(compilerOutput, ...file.split("/"));
		mkdirSync(join(absolute, ".."), { recursive: true });
		writeFileSync(absolute, `export const file = ${JSON.stringify(file)};\n`);
	}

	const rootModule: {
		resource?: string;
		rawRequest?: string;
	} = {};
	if (rootHasResource) {
		rootModule.resource = join(repoRoot, ...ENTRY.split("/"));
	}
	if (rootRawRequest) rootModule.rawRequest = rootRawRequest;
	const dependencyModules = requiredResources.map((resource) => ({
		resource: join(repoRoot, ...resource.split("/")),
	}));
	const ownerModule = {
		resource: join(repoRoot, "virtual-concatenated-owner.js"),
		modules: [rootModule],
	};
	const actualOwner = concatenated ? ownerModule : rootModule;
	const rootChunk = { files: rootFiles, auxiliaryFiles: [] };
	const entryChunk = { files: entrypointFiles, auxiliaryFiles: [] };
	const compilation = {
		modules: [actualOwner, ...dependencyModules],
		entrypoints: new Map([
			["app/c7-headless/route", { chunks: [entryChunk] }],
		]),
		assets: {},
		moduleGraph: {
			getOutgoingConnections: (module: object) =>
				module === rootModule
					? dependencyModules.map((dependency) => ({ module: dependency }))
					: [],
		},
		chunkGraph: {
			getModuleChunksIterable: (module: object) =>
				(module === actualOwner ||
					dependencyModules.some((dependency) => dependency === module)) &&
				rootFiles.length > 0
					? [rootChunk]
					: [],
		},
		hash: `root-${concatenated ? "concatenated" : "direct"}`,
	};
	let afterEmit:
		| ((value: typeof compilation) => Promise<void>)
		| undefined;
	const compiler = {
		outputPath: compilerOutput,
		hooks: {
			afterEmit: {
				tapPromise: (
					_name: string,
					callback: (value: typeof compilation) => Promise<void>,
				) => {
					afterEmit = callback;
				},
			},
		},
	};
	const plugin = new HeadlessWebpackGraphPlugin({
		repoRoot,
		outputRoot: "out",
		entry: ENTRY,
		webpackEntrypoint: "app/c7-headless/route",
		marker: "c7-next-root-membership",
		acceptedHead: "a".repeat(40),
		acceptedTree: "b".repeat(40),
	});
	plugin.apply(compiler);
	if (!afterEmit) throw new Error("Webpack afterEmit hook was not installed");
	await afterEmit(compilation);
	return {
		envelope: JSON.parse(
			readFileSync(join(outputRoot, "c7-headless-graph.json"), "utf8"),
		) as Record<string, unknown>,
		repoRoot,
	};
}

describe("C7 Next exact-root emitted membership", () => {
	test("rejects an entrypoint file when the exact root owns zero chunks", async () => {
		await expect(runGraphScenario()).rejects.toThrow(
			/root.*chunk|emitted.*root/i,
		);
	});

	test("accepts actual chunk membership carried by a concatenated owner", async () => {
		const file = "app/c7-headless/route.js";
		const { envelope } = await runGraphScenario({
			concatenated: true,
			rootFiles: [file],
		});
		expect(envelope.entry).toMatchObject({
			emitted: true,
			observed: ENTRY,
		});
		expect(envelope.modules).toMatchObject({
			items: [
				{
					id: "apps/web/src/app/c7-headless/route.ts",
					chunks: [`server/${file}`],
				},
			],
		});
	});

	test("rejects owner chunks outside the named webpack entrypoint", async () => {
		await expect(
			runGraphScenario({
				concatenated: true,
				rootFiles: ["chunks/headless-owner.js"],
				entrypointFiles: ["app/c7-headless/route.js"],
			}),
		).rejects.toThrow(/root chunks.*named webpack entrypoint/i);
	});

	test("rejects truncated root chunk bytes before publishing an envelope", async () => {
		const file = "app/c7-headless/route.js";
		await expect(
			runGraphScenario({ rootFiles: [file], writtenFiles: [] }),
		).rejects.toThrow(/ENOENT|no such file/i);
	});

	test("rejects a full alias-only producer-to-checker root without a resolved resource", async () => {
		const file = "app/c7-headless/route.js";
		await expect(
			(async () => {
				const { envelope, repoRoot } = await runGraphScenario({
					rootHasResource: false,
					rootRawRequest: ENTRY,
					requiredResources: REQUIRED_RESOURCES,
					rootFiles: [file],
				});
				return checkHeadlessGraphEnvelope(envelope, {
					host: "next",
					producer: "next-webpack",
					entry: ENTRY,
					marker: "c7-next-root-membership",
					acceptedHead: "a".repeat(40),
					acceptedTree: "b".repeat(40),
					repositoryRoot: repoRoot,
				});
			})(),
		).rejects.toThrow(/resolved resource|resolve exactly once|exact root/i);
	});
});
