import { expect, spyOn, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
	ProgrammaticSource,
	ProgrammaticResource,
} from "@opencut/editor-contracts";
import { CURRENT_PROJECT_VERSION } from "@opencut/editor-classic/transactions";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { runAgentCli } from "../agent-cli";
import { FileProjectStore } from "../file-store";
import {
	loadProgrammaticResource,
	resourceDigest,
} from "../programmatic/resources";
import type { InspectedComposition } from "../programmatic/remotion-inspection-types";

const executable = process.env.ROCUT_TEST_BROWSER_EXECUTABLE;
const toolchainDirectory = process.env.ROCUT_ENGINE_TOOLCHAIN_DIR;

interface Receipt {
	revision: string;
	inputs: ProgrammaticResource[];
	toolchainLockSha256: string;
	compositions: InspectedComposition[];
}

test.skipIf(!executable || !toolchainDirectory)(
	"authenticated real Host CLI inspection response preserves receipt through context GET and immutable compile without applying timeline",
	async () => {
		const parent = resolve(tmpdir()),
			root = await mkdtemp(join(parent, "rocut-inspection-host-"));
		const author = join(root, "author"),
			projectRoot = join(root, "project");
		const registry = new TargetRegistry(join(root, "registry"));
		await mkdir(author);
		const original = `import React from 'react';import {registerRoot,Composition} from 'remotion';
const Scene=({label})=><div>original-host-marker {label}</div>;
registerRoot(()=> <Composition id="HostExample" component={Scene} width={64} height={64} fps={30}
 durationInFrames={60} defaultProps={{label:'default',preserved:1}}
 calculateMetadata={async({props})=>{await new Promise(r=>setTimeout(r,20));return {width:80,height:96,durationInFrames:90,props:{...props,derived:'resolved'}};}}/>);`;
		await writeFile(join(author, "index.tsx"), original, "utf8");
		const host = await startHost({
			projectRoot,
			registry,
			engineToolchainDirectory: toolchainDirectory,
			htmlBrowserExecutable: executable,
			htmlFrameConnectionFile: "",
		});
		let closed = false;
		try {
			const resolved = await registry.resolve(host.targetId);
			if (!resolved) throw Error("Dedicated test Host unavailable in registry");
			const context = {
				store: new FileProjectStore({
					root: projectRoot,
					schemaVersion: CURRENT_PROJECT_VERSION,
				}),
				projectId: host.automation.projectId,
			};
			const record = () => readFile(join(projectRoot, "project.json"), "utf8");
			const recordBefore = await record(),
				clipsBefore = await host.automation.clips();
			const headers = () =>
				context.store.listAttachmentHeaders({ projectId: context.projectId });
			const headersBefore = await headers();
			const contextBefore = await (
				await fetch(new URL("api/context", host.editorUrl))
			).json();
			const inputFile = join(root, "request.json");
			const cli = async <T>(action: string, input: unknown): Promise<T> => {
				await writeFile(inputFile, JSON.stringify(input), "utf8");
				let output = "";
				const capture = spyOn(process.stdout, "write").mockImplementation(
					(chunk) => {
						output += Buffer.from(chunk).toString("utf8");
						return true;
					},
				);
				try {
					await runAgentCli({
						command: "programmatic",
						positional: [action, inputFile],
						resolved,
					});
					return JSON.parse(output) as T;
				} finally {
					capture.mockRestore();
				}
			};
			const receipt = await cli<Receipt>("inspect", {
				version: 1,
				sourceDirectory: author,
				entryFile: "index.tsx",
				files: ["index.tsx"],
				seed: 7,
				inputProps: { label: "输入" },
			});
			expect(receipt.compositions).toMatchObject([
				{
					id: "HostExample",
					width: 80,
					height: 96,
					fps: 30,
					durationFrames: 90,
					props: { label: "输入", preserved: 1, derived: "resolved" },
				},
			]);
			expect(await headers()).toEqual(headersBefore);
			expect(await record()).toBe(recordBefore);
			// The CLI has consumed the entire inspect HTTP response. Subsequent HTTP
			// activity must not clear its receipt through response-close cancellation.
			const contextAfterInspect = await (
				await fetch(new URL("api/context", host.editorUrl))
			).json();
			expect(contextAfterInspect.revision).toBe(contextBefore.revision);
			expect(
				contextAfterInspect.programmaticBuilds.remotionInspection.configured,
			).toBe(true);
			await writeFile(
				join(author, "index.tsx"),
				"throw Error('host must not execute changed author');",
				"utf8",
			);
			await rename(author, join(root, "author-removed"));
			const selection = {
				revision: receipt.revision,
				compositionId: "HostExample",
				frameRate: { numerator: 30, denominator: 1 },
			};
			const result = await cli<{
				source: ProgrammaticSource;
				inspectionRevision: string;
				metadataStability: string;
			}>("compile-inspected", selection);
			expect(result.inspectionRevision).toBe(receipt.revision);
			expect(result.metadataStability).toBe(
				"rechecked-before-compile; runtime-geometry-checked; runtime-props-not-pinned",
			);
			expect(result.source).toMatchObject({
				width: 80,
				height: 96,
				durationFrames: 90,
				seed: 7,
				frameRate: selection.frameRate,
				build: {
					engine: "remotion",
					compositionId: "HostExample",
					inputProps: { label: "输入" },
				},
			});
			if (!result.source.build) throw Error("Missing saved build archive");
			expect(result.source.build.inputs).toEqual(receipt.inputs);
			expect(result.source.build.toolchainLock.sha256).toBe(
				receipt.toolchainLockSha256,
			);
			const entry = await loadProgrammaticResource({
				...context,
				resource: result.source.build.inputs[0],
			});
			expect(new TextDecoder("utf-8", { fatal: true }).decode(entry.body)).toBe(
				original,
			);
			expect(entry.resource.sha256).toBe(
				resourceDigest(new TextEncoder().encode(original).buffer),
			);
			const document = await loadProgrammaticResource({
				...context,
				resource: result.source.resources!.find(
					(resource) => resource.id === result.source.documentId,
				)!,
			});
			expect(new TextDecoder().decode(document.body)).toContain(
				"__rocutRenderRemotionFrame",
			);
			expect(await record()).toBe(recordBefore);
			expect(await host.automation.clips()).toEqual(clipsBefore);
			const headersAfterCompile = await headers();
			expect(headersAfterCompile.length).toBeGreaterThan(headersBefore.length);
			const repeated = await fetch(
				new URL("api/programmatic/build/compile-inspected", host.editorUrl),
				{ method: "POST", body: JSON.stringify(selection) },
			);
			expect(repeated.status).toBe(422);
			expect(await repeated.text()).toContain("revision unavailable");
			expect(await headers()).toEqual(headersAfterCompile);
			expect(await record()).toBe(recordBefore);
			await host.close();
			closed = true;
			expect(await registry.list()).toEqual([]);
		} finally {
			if (!closed) await host.close();
			if (
				dirname(root) !== parent ||
				!basename(root).startsWith("rocut-inspection-host-")
			)
				throw Error("Unsafe Host inspection fixture cleanup");
			await rm(root, { recursive: true, force: true });
		}
	},
	60000,
);
