import { expect, spyOn, test } from "bun:test";
import { InMemoryProjectStore } from "@opencut/editor-ports/in-memory";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import {
	describeResource,
	saveResourceBytes,
} from "../programmatic/resource-bytes";
import {
	loadProgrammaticResource,
	resourceDigest,
} from "../programmatic/resources";
import { compileProgrammaticProject } from "../programmatic/engines/compile-project";
import {
	parseCompileInput,
	sourceDescription,
} from "../programmatic/engines/build-source";
import { parseBuildRevisionInput } from "../programmatic/engines/build-revision";
import {
	revisionFixture,
	type BuildResult,
} from "./programmatic-build-revision-fixture";

test("build revise admits transport membership only after Rust source validation", () => {
	const { source } = parseCompileInput({
		version: 1,
		engine: "remotion",
		sourceDirectory: "C:/not-read",
		entryFile: "index.tsx",
		files: ["index.tsx", "pixel.png"],
		compositionId: "Rocut",
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 60,
		seed: 7,
	});
	for (const input of [
		null,
		{ source, changes: [], unknown: true },
		{ source, changes: null },
		{ source, changes: [{ id: "unknown.tsx", code: "x" }] },
		{
			source,
			changes: [
				{ id: "index.tsx", code: "a" },
				{ id: "index.tsx", code: "b" },
			],
		},
		{ source, changes: [{ id: "pixel.png", code: "binary replacement" }] },
		{ source, changes: [{ id: "index.tsx", code: "x", path: "other" }] },
		{ source: { ...source, width: 0 }, changes: [] },
		{ source, changes: [], inputProps: null },
		{ source, changes: [], inputProps: [] },
		{ source, changes: [], inputProps: { huge: "x".repeat(262145) } },
	])
		expect(() => parseBuildRevisionInput(input)).toThrow();
	expect(
		parseBuildRevisionInput({ source, changes: [], inputProps: {} }).inputProps,
	).toEqual({});
});

const toolchain = process.env.ROCUT_TEST_BUILD_REVISION_TOOLCHAIN;
test("Three revise is unavailable before any archive or toolchain IO", async () => {
	const { source } = parseCompileInput({
		version: 1,
		engine: "three",
		sourceDirectory: "C:/must-not-read",
		entryFile: "main.ts",
		files: ["main.ts"],
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 60,
		seed: 7,
	});
	const store = new InMemoryProjectStore();
	const read = spyOn(store, "loadAttachment"),
		write = spyOn(store, "saveAttachment");
	try {
		await expect(
			compileProgrammaticProject({
				action: "revise",
				input: { source, changes: [] },
				toolchainDirectory: "C:/must-not-read",
				context: { store, projectId: "three-revise-rejected" },
				signal: new AbortController().signal,
				enqueue: async (task) => task(),
			}),
		).rejects.toThrow("only HyperFrames and Remotion");
		expect(read).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
	} finally {
		read.mockRestore();
		write.mockRestore();
	}
});

for (const engine of ["hyperframes", "remotion"] as const) {
	test.skipIf(!toolchain)(
		`${engine} real archive revision rejects unsafe inputs and keeps both old and revised builds reproducible`,
		async () => {
			const fixture = await revisionFixture(engine, toolchain!);
			try {
				const { post, success, context, entryFile, code, headers } = fixture;
				const record = await fixture.readRecord();
				const initial = await success("compile", fixture.spec);
				const originalJson = JSON.stringify(initial.source);
				if (!initial.source.build) throw Error("Missing initial build archive");
				const baseline = initial.source.build;
				await rename(fixture.author, join(fixture.root, "author-moved"));
				const capability = await (
					await fetch(new URL("api/context", fixture.host.editorUrl))
				).json();
				expect(capability.programmaticBuilds).toMatchObject({
					revise: "programmatic/build/revise",
					reviseScope: "existing-text-files-and-input-props",
				});
				expect(
					(
						await fetch(
							new URL(
								"/wrong/api/programmatic/build/revise",
								fixture.host.editorUrl,
							),
							{ method: "POST", body: "{}" },
						)
					).status,
				).toBe(401);
				const rejectUnchanged = async (input: unknown, error?: string) => {
					const before = await headers();
					const response = await post("revise", input);
					expect(response.status).toBe(422);
					if (error) expect(await response.text()).toContain(error);
					expect(await headers()).toEqual(before);
					expect(await fixture.readRecord()).toBe(record);
					expect(JSON.stringify(initial.source)).toBe(originalJson);
				};
				for (const input of [
					{ source: initial.source, changes: [{ id: "new.js", code: "x" }] },
					{
						source: initial.source,
						changes: [
							{ id: entryFile, code },
							{ id: entryFile, code },
						],
					},
					{ source: initial.source, changes: [{ id: "pixel.png", code: "x" }] },
					{ source: initial.source, changes: [], inputProps: null },
					{
						source: initial.source,
						changes: [],
						inputProps: { huge: "x".repeat(262145) },
					},
				])
					await rejectUnchanged(input);
				await rejectUnchanged(
					{
						source: initial.source,
						changes: [{ id: entryFile, code: "\ud800" }],
					},
					"lossless UTF-8",
				);
				if (engine === "hyperframes")
					await rejectUnchanged(
						{ source: initial.source, changes: [], inputProps: {} },
						"Remotion/Three",
					);
				const originalInput = baseline.inputs.find(
					(item) => item.id === entryFile,
				)!;
				const badBytes = new Uint8Array([0xc3, 0x28]);
				const badText = describeResource(
					sourceDescription(entryFile),
					badBytes.byteLength,
					resourceDigest(badBytes.buffer),
				);
				await saveResourceBytes(context, {
					resource: badText,
					body: badBytes.buffer,
				});
				await rejectUnchanged({
					source: {
						...initial.source,
						build: {
							...baseline,
							inputs: baseline.inputs.map((item) =>
								item.id === entryFile ? badText : item,
							),
						},
					},
					changes: [{ id: entryFile, code }],
				});
				for (const resource of [
					originalInput,
					baseline.inputs.find((item) => item.id === "pixel.png")!,
					baseline.toolchainLock,
				]) {
					const attachment = await context.store.loadAttachment({
						projectId: context.projectId,
						key: resource.attachmentKey,
					});
					if (!attachment) throw Error("Missing archived fixture attachment");
					await context.store.saveAttachment({
						...attachment,
						body: new Uint8Array([99]).buffer,
					});
					try {
						await rejectUnchanged(
							{ source: initial.source, changes: [] },
							"integrity mismatch",
						);
					} finally {
						await context.store.saveAttachment(attachment);
					}
				}
				const oldLockBytes = new TextEncoder().encode(
					'{"different":"toolchain"}',
				);
				const oldLock = describeResource(
					sourceDescription(baseline.toolchainLock.id),
					oldLockBytes.byteLength,
					resourceDigest(oldLockBytes.buffer),
				);
				await saveResourceBytes(context, {
					resource: oldLock,
					body: oldLockBytes.buffer,
				});
				await rejectUnchanged(
					{
						source: {
							...initial.source,
							build: { ...baseline, toolchainLock: oldLock },
						},
						changes: [],
					},
					"Archived toolchain differs",
				);
				const broken =
					engine === "hyperframes"
						? code.replace('data-width="64"', 'data-width="65"')
						: 'import "node:fs";';
				await rejectUnchanged(
					{
						source: initial.source,
						changes: [{ id: entryFile, code: broken }],
					},
					"Engine compiler failed",
				);
				const tooLarge = await post("revise", {
					source: initial.source,
					changes: [{ id: entryFile, code: "x".repeat(1000001) }],
				});
				expect(tooLarge.status).toBe(413);
				const revisedCode = code.replace(
					"original-marker",
					"revision-marker-中文-🎬",
				);
				const request = {
					source: initial.source,
					changes: [{ id: entryFile, code: revisedCode }],
				};
				const concurrent = await Promise.all([
					post("revise", request),
					post("revise", request),
				]);
				expect(concurrent.map((response) => response.status).sort()).toEqual([
					200, 429,
				]);
				const revised: BuildResult = await concurrent
					.find((response) => response.status === 200)!
					.json();
				expect(revised.reusedDocument).toBe(false);
				expect(revised.source.build?.inputProps).toEqual(baseline.inputProps);
				expect(revised.source.resources?.[0].sha256).not.toBe(
					initial.source.resources?.[0].sha256,
				);
				const revisedInput = revised.source.build?.inputs.find(
					(item) => item.id === entryFile,
				);
				if (!revisedInput) throw Error("Missing revised input");
				expect(
					new TextDecoder("utf-8", { fatal: true }).decode(
						(
							await loadProgrammaticResource({
								...context,
								resource: revisedInput,
							})
						).body,
					),
				).toBe(revisedCode);
				expect(revisedInput.sha256).not.toBe(originalInput.sha256);
				expect(
					new TextDecoder().decode(
						(
							await loadProgrammaticResource({
								...context,
								resource: originalInput,
							})
						).body,
					),
				).toBe(code);
				expect(JSON.stringify(initial.source)).toBe(originalJson);
				expect(await fixture.readRecord()).toBe(record);
				expect(await success("rebuild", initial.source)).toEqual({
					source: initial.source,
					reusedDocument: true,
				});
				expect(await success("rebuild", revised.source)).toEqual({
					source: revised.source,
					reusedDocument: true,
				});
				if (engine === "remotion") {
					const props = { caption: "props-only", nested: { enabled: true } };
					const propsOnly = await success("revise", {
						source: revised.source,
						changes: [],
						inputProps: props,
					});
					expect(propsOnly.source.build?.inputs).toEqual(
						revised.source.build?.inputs,
					);
					expect(propsOnly.source.build?.inputProps).toEqual(props);
					expect(propsOnly.source.resources?.[0].sha256).not.toBe(
						revised.source.resources?.[0].sha256,
					);
				}
				const controller = new AbortController(),
					beforeCancel = await headers();
				await expect(
					compileProgrammaticProject({
						action: "revise",
						input: {
							source: initial.source,
							changes: [
								{
									id: entryFile,
									code: code.replace("original-marker", "cancelled-marker"),
								},
							],
						},
						toolchainDirectory: toolchain!,
						context,
						signal: controller.signal,
						enqueue: async (task) => {
							controller.abort();
							return task();
						},
					}),
				).rejects.toThrow();
				expect(await headers()).toEqual(beforeCancel);
				expect(await fixture.readRecord()).toBe(record);
				expect(Number(await fixture.host.automation.revision())).toBe(0);
			} finally {
				await fixture.cleanup();
			}
		},
		60000,
	);
}
