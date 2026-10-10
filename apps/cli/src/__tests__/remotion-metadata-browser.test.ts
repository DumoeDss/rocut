import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { revisionFixture } from "./programmatic-build-revision-fixture";
import { createRemotionInspectionSession } from "../programmatic/remotion-inspection-service";
import { compileProgrammaticProject } from "../programmatic/engines/compile-project";
import { renderHtmlPng } from "../programmatic/html-rasterizer";
import { loadProgrammaticResource } from "../programmatic/resources";

const executable = process.env.ROCUT_TEST_BROWSER_EXECUTABLE;
const toolchainDirectory = process.env.ROCUT_ENGINE_TOOLCHAIN_DIR;
const enabled =
	process.env.ROCUT_RUN_REMOTION_METADATA_BROWSER === "1" &&
	executable &&
	toolchainDirectory;

for (const variant of [
	"same",
	"props",
	"array",
	"geometry",
	"stall",
	"illegal",
] as const) {
	test.skipIf(!enabled)(
		`real pinned metadata browser: ${variant}`,
		async () => {
			const fixture = await revisionFixture("remotion", toolchainDirectory!);
			const session = createRemotionInspectionSession({
				context: fixture.context,
				executable: executable!,
				toolchainDirectory: toolchainDirectory!,
				enqueue: async <T>(task: () => Promise<T>) => task(),
			});
			try {
				const runtime =
					variant === "props"
						? "return {props:{...props,list:[1,2],derived:'drift'}};"
						: variant === "array"
							? "return {props:{...props,list:[2,1],derived:'fixed'}};"
							: variant === "geometry"
								? "return {width:65,props:{...props,list:[1,2],derived:'fixed'}};"
								: variant === "stall"
									? "return new Promise(()=>{});"
									: "return {props:{derived:'fixed',list:[1,2],...props}};";
				const calculate =
					variant === "illegal"
						? "return {props:{bad:new Date()}};"
						: `if(window.__rocutRemotionMetadataPolicy){${runtime}} return {props:{...props,list:[1,2],derived:'fixed'}};`;
				const protection = `if(window.__rocutRemotionMetadataPolicy){const d=Object.getOwnPropertyDescriptor(window,'__rocutRemotionSpec');if(d.writable||d.configurable||!Object.isFrozen(window.__rocutRemotionSpec.inputProps))throw Error('authority mutable');try{Object.defineProperty(window,'__rocutRemotionSpec',{value:{}});throw Error('authority replaced');}catch(e){if(e.message==='authority replaced')throw e;}}`;
				const code = `import React from 'react';import {Composition,registerRoot} from 'remotion';${protection}const Scene=props=><div style={{width:'100%',height:'100%',background:props.derived==='fixed'?'red':'blue'}}/>;registerRoot(()=><Composition id="Rocut" component={Scene} width={64} height={64} fps={30} durationInFrames={60} calculateMetadata={async({props})=>{${calculate}}}/>);`;
				await writeFile(join(fixture.author, fixture.entryFile), code, "utf8");
				const inspection = session.perform({
					action: "inspect",
					input: {
						version: 1,
						sourceDirectory: fixture.author,
						entryFile: fixture.entryFile,
						files: fixture.spec.files,
						seed: 7,
						inputProps: fixture.spec.inputProps,
					},
					signal: new AbortController().signal,
				});
				if (variant === "illegal") {
					await expect(inspection).rejects.toThrow("JSON");
					return;
				}
				const receipt = await inspection;
				if (!("revision" in receipt) || !receipt.revision)
					throw Error("Expected inspection");
				const compiled = await session.perform({
					action: "compile-inspected",
					input: {
						revision: receipt.revision,
						compositionId: "Rocut",
						frameRate: { numerator: 30, denominator: 1 },
					},
					signal: new AbortController().signal,
				});
				if (!("source" in compiled)) throw Error("Expected compilation");
				const capture = renderHtmlPng({
					executable: executable!,
					resourceStore: fixture.context,
					signal: new AbortController().signal,
					request: {
						source: compiled.source,
						clipStart: 0,
						clipDuration: 240000,
						trimStart: 0,
						timelineTime: 0,
					},
				});
				if (variant !== "same") {
					await expect(capture).rejects.toThrow(
						variant === "stall"
							? "timed out"
							: variant === "geometry"
								? "metadata differs"
								: "props differ",
					);
					return;
				}
				expect((await capture).subarray(1, 4).toString()).toBe("PNG");
				const rebuilt = await compileProgrammaticProject({
					action: "rebuild",
					input: compiled.source,
					context: fixture.context,
					toolchainDirectory: toolchainDirectory!,
					signal: new AbortController().signal,
					enqueue: async <T>(task: () => Promise<T>) => task(),
				});
				expect(rebuilt.runtimeMetadata?.status).toBe("metadata-pinned-v1");
				const resource = rebuilt.source.resources!.find(
					(item) => item.id === rebuilt.source.documentId,
				)!;
				const document = await loadProgrammaticResource({
					...fixture.context,
					resource,
				});
				expect(new TextDecoder().decode(document.body)).toContain(
					'id="rocut-remotion-metadata-receipt"',
				);
			} finally {
				session.clear();
				await fixture.cleanup();
			}
		},
		60000,
	);
}
