import { expect, spyOn, test } from "bun:test";
import {
	parseCompileInput,
	withBuildResources,
} from "../programmatic/engines/build-source";
import { compileProgrammaticProject } from "../programmatic/engines/compile-project";
import { InMemoryProjectStore } from "@opencut/editor-ports/in-memory";
import {
	describeResource,
	saveResourceBytes,
} from "../programmatic/resource-bytes";
import { resourceDigest } from "../programmatic/resources";
import * as samplerWorker from "../programmatic/particle-sampler-worker";

const specification = {
	version: 1,
	engine: "three",
	sourceDirectory: "C:/declared-author-directory",
	entryFile: "index.ts",
	files: ["index.ts"],
	width: 64,
	height: 64,
	frameRate: { numerator: 25, denominator: 1 },
	durationFrames: 8,
	seed: 0,
};

// These tests exercise the actual Rust source validator. Run with the matching
// regenerated WASM package; an old binary must not be papered over by a TS mock.
test("compile accepts only the explicit Rust-validated Three particle capability", () => {
	const parsed = parseCompileInput({
		...specification,
		capabilities: ["particle-surface-v1"],
	});
	expect(parsed.source.build?.capabilities).toEqual(["particle-surface-v1"]);
	expect(parsed.sourceDirectory).toBe(specification.sourceDirectory);
	for (const capabilities of [
		null,
		[],
		["other"],
		["particle-surface-v1", "particle-surface-v1"],
		{ particleSurface: true },
	])
		expect(() =>
			parseCompileInput({ ...specification, capabilities }),
		).toThrow();
	for (const engine of ["remotion", "hyperframes"])
		expect(() =>
			parseCompileInput({
				...specification,
				engine,
				compositionId: engine === "remotion" ? "Scene" : undefined,
				capabilities: ["particle-surface-v1"],
			}),
		).toThrow();
});

test("ordinary Three stays unmarked; inputProps and author-supplied identity cannot grant capability", () => {
	const ordinary = parseCompileInput(specification).source;
	expect(Object.hasOwn(ordinary.build!, "capabilities")).toBe(false);
	const authored = parseCompileInput({
		...specification,
		inputProps: {
			capabilities: ["particle-surface-v1"],
			policyHash: "a".repeat(64),
		},
	}).source;
	expect(Object.hasOwn(authored.build!, "capabilities")).toBe(false);
	expect(authored.build?.inputProps?.capabilities).toEqual([
		"particle-surface-v1",
	]);
	for (const key of [
		"threeParticle",
		"samplerIdentity",
		"policyHash",
		"moduleUrl",
		"particleSurface",
	])
		expect(() => parseCompileInput({ ...specification, [key]: {} })).toThrow(
			"Unknown compile specification field",
		);
});

for (const action of ["rebuild", "revise"] as const)
	test(`${action} rejects archive/capability contradictions before sampler or toolchain discovery`, async () => {
		for (const declared of [false, true]) {
			const { source } = parseCompileInput({
				...specification,
				...(declared ? { capabilities: ["particle-surface-v1"] } : {}),
			});
			const resourceStore = {
				projectId: "three-particle-rebuild",
				store: new InMemoryProjectStore(),
			};
			const prepared = [
				{
					id: "index.ts",
					text: "export function createScene() { throw Error('must not execute') }",
				},
				{
					id: "_rocut/toolchain-lock.json",
					text: JSON.stringify({
						version: 1,
						packages: [],
						...(declared ? {} : { threeParticle: { authorSupplied: true } }),
					}),
				},
			].map(({ id, text }) => {
				const body = new TextEncoder().encode(text).buffer;
				return {
					body,
					resource: describeResource(
						{ id, kind: "source", mimeType: "application/octet-stream" },
						body.byteLength,
						resourceDigest(body),
					),
				};
			});
			for (const value of prepared)
				await saveResourceBytes(resourceStore, value);
			const archived = withBuildResources(
				source,
				[prepared[0].resource],
				prepared[1].resource,
			);
			const read = spyOn(resourceStore.store, "loadAttachment");
			const write = spyOn(resourceStore.store, "saveAttachment");
			const sampler = spyOn(samplerWorker, "createParticleSamplerWorker");
			try {
				await expect(
					compileProgrammaticProject({
						action,
						input:
							action === "revise"
								? { source: archived, changes: [] }
								: archived,
						toolchainDirectory: "C:/this-toolchain-must-not-be-read",
						context: resourceStore,
						signal: new AbortController().signal,
						enqueue: async (task) => task(),
					}),
				).rejects.toThrow(
					action === "revise"
						? "only HyperFrames and Remotion"
						: "explicitly recompile",
				);
				// Three revise remains unsupported: malformed particle archives must
				// not widen that existing admission boundary or discover a sampler.
				if (action === "revise") expect(read).not.toHaveBeenCalled();
				expect(write).not.toHaveBeenCalled();
				expect(sampler).not.toHaveBeenCalled();
			} finally {
				read.mockRestore();
				write.mockRestore();
				sampler.mockRestore();
			}
		}
	});
