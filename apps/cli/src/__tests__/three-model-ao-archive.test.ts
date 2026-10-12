import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { threeModel, threePalette } from "../../../../script/fixtures/three-assets";
import type { BuildResult } from "./programmatic-build-revision-fixture";

const toolchain = process.env.ROCUT_TEST_THREE_TOOLCHAIN;
const creator = process.env.ROCUT_TEST_MODEL_CREATOR_ASSETS;
const legacy = process.env.ROCUT_TEST_LEGACY_MODEL_SCENE;
const slots = ["map", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap", "alphaMap", "aoMap"];

test.skipIf(!toolchain || !creator || !legacy)(
	"HTTP AO v2 and genuine v1 archives revise/rebuild/reopen without implicit consumer upgrade",
	async () => {
		const root = await mkdtemp(join(process.env.ROCUT_TEST_ARTIFACT_ROOT ?? tmpdir(), "rocut-model-ao-archive-"));
		const projectRoot = join(root, "project");
		const options = { projectRoot, registry: new TargetRegistry(join(root, "registry")),
			engineToolchainDirectory: toolchain!, htmlBrowserExecutable: "", htmlFrameConnectionFile: "" };
		let host = await startHost(options);
		const json = async <T>(route: string, input?: unknown): Promise<T> => {
			const response = await fetch(new URL(`api/${route}`, host.editorUrl), {
				method: input === undefined ? "GET" : "POST",
				...(input === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(input) }),
				signal: AbortSignal.timeout(30000),
			});
			const result = await response.json();
			if (!response.ok) throw Error(JSON.stringify(result));
			return result as T;
		};
		const persisted = (id: string) => host.automation.clips().then(clips => clips.find(clip => clip.id === id)?.editing?.programmatic);
		const context = () => json<{ revision: number }>("context");
		const record = () => readFile(join(projectRoot, "project.json"), "utf8");
		const archiveText = async (source: ProgrammaticSource) => {
			const input = source.build!.inputs.find(item => item.id === "model-feature-scene.ts")!;
			const response = await fetch(new URL("api/programmatic/resources/load", host.editorUrl), {
				method: "POST", body: JSON.stringify(input), signal: AbortSignal.timeout(10000),
			});
			expect(response.status).toBe(200);
			return new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer());
		};
		const revisedSources: Record<string, ProgrammaticSource> = {};
		try {
			await writeFile(join(root, "model.glb"), threeModel());
			await writeFile(join(root, "ao.png"), threePalette());
			const resources: Array<NonNullable<ProgrammaticSource["resources"]>[number]> = [];
			for (const [file, kind, mimeType] of [["model.glb", "model", "model/gltf-binary"], ["ao.png", "image", "image/png"]]) {
				resources.push((await json<{ resource: NonNullable<ProgrammaticSource["resources"]>[number] }>("programmatic/resources/import", {
					id: `assets/${file}`, kind, mimeType, filePath: join(root, file),
				})).resource);
			}
			await json("apply", { expectedRevision: (await context()).revision,
				operations: [{ kind: "create-track", track: { id: "models", name: "Models", kind: "graphic", hidden: false } }] });
			const { modelThree } = await import(pathToFileURL(join(creator!, "model-features.mjs")).href);
			for (const version of [2, 1]) {
				const id = `model-v${version}`, author = join(root, id);
				await mkdir(author);
				const code = await readFile(version === 2 ? join(creator!, "model-feature-scene.ts") : legacy!, "utf8");
				expect(code).toContain(`rocut-model-texture-bindings-v${version}`);
				expect(code).not.toContain(`rocut-model-texture-bindings-v${version === 2 ? 1 : 2}`);
				await writeFile(join(author, "model-feature-scene.ts"), code, "utf8");
				const expectedSlots = version === 2 ? slots : slots.slice(0, 6);
				const { spec } = modelThree({ sourceDirectory: author, model: resources[0],
					textureBindings: expectedSlots.map(slot => ({ image: resources[1], mesh: "body", material: 0, slot, flipY: true })),
					settings: { width: 64, height: 64, durationFrames: 2, frameRate: { numerator: 30, denominator: 1 }, seed: 19 } });
				const initial = await json<BuildResult>("programmatic/build/compile", spec);
				expect(initial.source.build!.inputProps).toEqual(spec.inputProps);
				expect(initial.source.resources!.slice(1)).toEqual(resources);
				await json("apply", { expectedRevision: (await context()).revision, operations: [{ kind: "create-clip", clip: {
					id, trackId: "models", startTime: version === 2 ? 0 : 8000, duration: 8000, trimStart: 0, trimEnd: 0,
					editing: { type: "graphic", name: id, definitionId: "programmatic", params: {}, programmatic: initial.source },
				} }] });
				await rename(author, join(root, `${id}-unavailable`));
				await host.close(); host = await startHost(options);
				expect(await persisted(id)).toEqual(initial.source);
				expect(await archiveText(initial.source)).toBe(code);
				const before = await record(), revision = (await context()).revision;
				const revisedCode = `${code}\n// archive-only v${version} revision\n`;
				const revised = await json<BuildResult>("programmatic/build/revise", { source: initial.source,
					changes: [{ id: "model-feature-scene.ts", code: revisedCode }], inputProps: { ...spec.inputProps, scale: 1.1 } });
				// Compilation archives immutable bytes, but does not submit a source edit.
				expect(await record()).toBe(before);
				expect((await context()).revision).toBe(revision);
				expect(revised.source.resources!.slice(1)).toEqual(resources);
				expect(revised.source.build!.inputProps).toEqual({ ...spec.inputProps, scale: 1.1 });
				expect(await archiveText(revised.source)).toBe(revisedCode);
				expect(await archiveText(initial.source)).toBe(code);
				await json("apply", { expectedRevision: revision, operations: [{ kind: "update-clip", clipId: id,
					patch: { editing: { type: "graphic", name: id, definitionId: "programmatic", params: {}, programmatic: revised.source } } }] });
				expect((await context()).revision).toBe(revision + 1);
				await host.close(); host = await startHost(options);
				expect(await persisted(id)).toEqual(revised.source);
				expect(await json<BuildResult>("programmatic/build/rebuild", revised.source)).toEqual({ source: revised.source, reusedDocument: true });
				expect(await json<BuildResult>("programmatic/build/rebuild", initial.source)).toEqual({ source: initial.source, reusedDocument: true });
				const archived = await archiveText(revised.source);
				expect(archived).toContain(`rocut-model-texture-bindings-v${version}`);
				expect(archived).not.toContain(`rocut-model-texture-bindings-v${version === 2 ? 1 : 2}`);
				revisedSources[id] = revised.source;
			}
			await writeFile(join(root, "receipt.json"), JSON.stringify({ ok: true, toolchain, creator, legacy,
				scope: "Source-level HTTP compile/revise/single Apply/reopen/archive-only rebuild; no GPU or mounted UI", revisedSources }, null, 2), { flag: "wx" });
		} finally { await host.close(); }
	},
	60000,
);
