import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { importProgrammaticResource } from "../../apps/cli/src/programmatic/resource-import";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { loadProgrammaticResources } from "../../apps/cli/src/programmatic/resources";
import { parseThreeLiquidObjectArchive } from "../../apps/cli/src/programmatic/three-liquid-object-provenance";
import { particlePoseGlb } from "./particle-input-resources";

export async function runLiquidAnimatedCompile({ root, toolchain, creator }: {
	root: string; toolchain: string; creator: string;
}) {
	const projectRoot = join(root, "project"), author = join(root, "author");
	await mkdir(author);
	const host = await startHost({ projectRoot, registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "", htmlFrameConnectionFile: "" });
	let receipt: unknown;
	try {
		const request = async (method: string, route: string, input?: unknown) => {
			const response = await fetch(new URL(`api/${route}`, host.editorUrl), { method,
				signal: AbortSignal.timeout(15_000), ...(input === undefined ? {} : {
					headers: { "content-type": "application/json" }, body: JSON.stringify(input),
				}) });
			const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
		};
		const hostContext = await request("GET", "context");
		assert.equal(hostContext.programmaticObjectParams.resolvers.find((item: { object: string }) => item.object === "liquid").available, true);
		const context = { store: new FileProjectStore({ root: projectRoot, schemaVersion: 1 }), projectId: hostContext.project.id };
		const bytes = particlePoseGlb(), filePath = join(root, "pose.glb");
		await writeFile(filePath, bytes, { flag: "wx" });
		const resource = (await importProgrammaticResource({ ...context,
			input: { id: "assets/pose.glb", kind: "model", mimeType: "model/gltf-binary", filePath },
		})).resource;
		const { liquidAnimatedObjectThree } = await import(pathToFileURL(join(creator, "liquid-animated-object.mjs")).href);
		const { rocutObjectParamsResolver } = await import(pathToFileURL(join(creator, "object-params-resolver.mjs")).href);
		let resolverCalls = 0;
		const resolver = rocutObjectParamsResolver({ object: "liquid", request: async (method: string, route: string, input: unknown) => {
			resolverCalls++; return request(method, route, input);
		} });
		const value = await liquidAnimatedObjectThree({ sourceDirectory: author, model: resource,
			settings: { width: 64, height: 64, durationFrames: 61, frameRate: { numerator: 30, denominator: 1 }, seed: 19 },
			inputProps: { animation: { clip: "pose", mode: "clamp", speed: 1, offset: 0 } },
			liquid: { amount: 0.35 }, resolveParams: resolver });
		assert.equal(resolverCalls, 1);
		for (const file of value.spec.files) await copyFile(join(creator, file), join(author, file));
		const compile = (action: "compile" | "rebuild", input: unknown) => compileProgrammaticProject({ action, input,
			toolchainDirectory: toolchain, context, signal: AbortSignal.timeout(30_000), enqueue: async task => task() });
		const result = await compile("compile", value.spec), source = result.source;
		assert.deepEqual(source.build!.capabilities, ["liquid-object-v1"]);
		assert.deepEqual(source.build!.inputProps, value.spec.inputProps);
		const archived = await loadProgrammaticResources(context,
			[...source.build!.inputs, source.build!.toolchainLock, ...source.resources!], new AbortController().signal);
		const lockBody = archived.find(item => item.resource.id === source.build!.toolchainLock.id)!.body;
		const lock = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(lockBody));
		const identity = parseThreeLiquidObjectArchive({ source, body: lockBody });
		assert(identity); assert.equal(identity.adapterSha256, lock.adapter.sha256);
		assert.equal(lock.threeAssetFeatures.profile, "svg-animation-v1");
		assert.equal(lock.threeAssetFeatures.files.length, 6);
		assert.deepEqual(source.build!.inputs.map(input => input.id).sort(), [...value.spec.files].sort());
		for (const input of source.build!.inputs) assert.deepEqual(Buffer.from(archived.find(item => item.resource.id === input.id)!.body), await readFile(join(author, input.id)));
		assert.deepEqual(Buffer.from(archived.find(item => item.resource.id === resource.id)!.body), bytes);
		const document = archived.find(item => item.resource.id === source.documentId)!;
		assert(document.body.byteLength > 100_000);
		await rename(author, join(root, "author-unavailable"));
		await rename(filePath, join(root, "original-unavailable.glb"));
		const rebuilt = await compile("rebuild", source);
		assert.deepEqual(rebuilt.source, source); assert.equal(rebuilt.reusedDocument, true);
		await writeFile(join(root, "source.json"), JSON.stringify(source, null, 2), { flag: "wx" });
		await writeFile(join(root, "compiled.html"), Buffer.from(document.body), { flag: "wx" });
		receipt = { ok: true, root, toolchain, creator, resolverCalls, resource, identity, lock,
			compiledBytes: document.body.byteLength, authorFiles: value.spec.files,
			archiveBytesVerified: true, authorAndOriginalMoved: true, archiveOnlyRebuild: true,
			scope: "real complete animated GLB import/owned authenticated public Liquid resolver/Creator helper/full compileProgrammaticProject/fixed native worker identity publication/exact archive bytes/archive-only rebuild; no author JS execution/native phase rendering/GPU/Vite/pack/new WASM" };
	} finally {
		await host.close();
		await writeFile(join(root, "cleanup.json"), JSON.stringify({ hostClosed: true, noSharedHostOrBrowser: true }), { flag: "wx" });
	}
	await writeFile(join(root, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
	return receipt;
}
