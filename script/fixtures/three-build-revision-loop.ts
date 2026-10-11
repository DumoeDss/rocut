import assert from "node:assert/strict";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InMemoryProjectStore } from "@opencut/editor-ports/in-memory";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { importProgrammaticResource } from "../../apps/cli/src/programmatic/resource-import";
import { loadProgrammaticResource } from "../../apps/cli/src/programmatic/resources";

export async function runThreeRevisionLoop({ root, toolchain }: { root: string; toolchain: string }) {
	const author = join(root, "author");
	await mkdir(author);
	const store = new InMemoryProjectStore();
	const context = { store, projectId: "three-revision-loop" as never };
	const core = (helper: string) => `import {caption} from './${helper}'; export function createScene({THREE,inputProps}){const scene=new THREE.Scene();scene.userData.caption=caption+inputProps.caption;return {scene,camera:new THREE.PerspectiveCamera(50,1,.1,100)}}`;
	await writeFile(join(author, "main.ts"), "export {createScene} from './scene-core';");
	await writeFile(join(author, "scene-core.ts"), core("old-helper"));
	await writeFile(join(author, "old-helper.ts"), 'export const caption="initial-marker";');
	const svgPath = join(root, "shape.svg");
	await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0H10V10H0Z"/></svg>');
	const { resource } = await importProgrammaticResource({ ...context, input: {
		id: "assets/shape.svg", kind: "model", mimeType: "image/svg+xml", filePath: svgPath,
	} });
	const compile = (action: "compile" | "revise" | "rebuild", input: unknown) => compileProgrammaticProject({
		action, input, toolchainDirectory: toolchain, context, signal: AbortSignal.timeout(30000), enqueue: async task => task(),
	});
	const initial = await compile("compile", { version: 1, engine: "three", sourceDirectory: author,
		entryFile: "main.ts", files: ["main.ts", "scene-core.ts", "old-helper.ts"],
		width: 64, height: 64, frameRate: { numerator: 30, denominator: 1 }, durationFrames: 60, seed: 7,
		resources: [resource], inputProps: { caption: "initial-prop" } });
	const baseline = JSON.stringify(initial.source);
	await rename(author, join(root, "author-unavailable"));
	await rename(svgPath, join(root, "shape-unavailable.svg"));
	const revised = await compile("revise", { source: initial.source, entryFile: "scene-entry.ts",
		inputProps: { caption: "revised-prop", preserved: true }, changes: [
			{ id: "main.ts", op: "rename", to: "scene-entry.ts" },
			{ id: "new-helper.ts", op: "add", code: 'export const caption="revision-marker";' },
			{ id: "scene-core.ts", code: core("new-helper") },
			{ id: "old-helper.ts", op: "delete" },
		] });
	assert.equal(revised.reusedDocument, false);
	assert.equal(revised.source.build!.entryFile, "scene-entry.ts");
	assert.deepEqual(revised.source.build!.inputs.map(item => item.id).sort(), ["new-helper.ts", "scene-core.ts", "scene-entry.ts"]);
	assert.deepEqual(revised.source.build!.inputProps, { caption: "revised-prop", preserved: true });
	for (const [id, code] of [["scene-entry.ts", "export {createScene} from './scene-core';"],
		["scene-core.ts", core("new-helper")], ["new-helper.ts", 'export const caption="revision-marker";']]) {
		const archived = revised.source.build!.inputs.find(item => item.id === id)!;
		assert.equal(new TextDecoder().decode((await loadProgrammaticResource({ ...context, resource: archived })).body), code);
	}
	assert.deepEqual(revised.source.resources!.find(item => item.id === resource.id), resource);
	assert.equal(JSON.stringify(initial.source), baseline);
	assert.deepEqual(await compile("rebuild", revised.source), { source: revised.source, reusedDocument: true });
	assert.deepEqual(await compile("rebuild", initial.source), { source: initial.source, reusedDocument: true });
	const headers = async () => (await store.listAttachmentHeaders({ projectId: context.projectId })).map(item => item.key).sort();
	const before = await headers();
	await assert.rejects(compile("revise", { source: revised.source, changes: [
		{ id: "scene-core.ts", code: 'import "./missing-helper"; export const broken = ;' },
	] }), /Engine compiler failed/);
	assert.deepEqual(await headers(), before);
	assert.equal(JSON.stringify(initial.source), baseline);
	const receipt = { ok: true, toolchain, scope: "CPU production compile/revise/archive-only rebuild; no renderer or GPU",
		entryFile: revised.source.build!.entryFile, files: revised.source.build!.inputs,
		inputProps: revised.source.build!.inputProps, resource, failedCompilePublished: false,
		initialDocument: initial.source.resources![0], revisedDocument: revised.source.resources![0] };
	await writeFile(join(root, "revision-receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
	return receipt;
}
