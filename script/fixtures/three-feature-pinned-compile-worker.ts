import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveGlassObjectParamsJson } from "opencut-wasm";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { importProgrammaticResource } from "../../apps/cli/src/programmatic/resource-import";
import { loadProgrammaticResources } from "../../apps/cli/src/programmatic/resources";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { threeEnvironment, threeModel } from "./three-assets";

/** Controlled GLB with a real linear node translation animation. */
function animatedModel() {
	const base = threeModel(),
		jsonLength = base.readUInt32LE(12);
	const model = JSON.parse(base.subarray(20, 20 + jsonLength).toString("utf8"));
	const binLength = base.readUInt32LE(20 + jsonLength);
	const bin = base.subarray(28 + jsonLength, 28 + jsonLength + binLength);
	const data = Buffer.from(new Float32Array([0, 2, 0, 0, 0, 1, 0, 0]).buffer);
	const view = model.bufferViews.length,
		accessor = model.accessors.length;
	model.bufferViews.push(
		{ buffer: 0, byteOffset: bin.length, byteLength: 8 },
		{ buffer: 0, byteOffset: bin.length + 8, byteLength: 24 },
	);
	model.accessors.push(
		{
			bufferView: view,
			componentType: 5126,
			count: 2,
			type: "SCALAR",
			min: [0],
			max: [2],
		},
		{ bufferView: view + 1, componentType: 5126, count: 2, type: "VEC3" },
	);
	model.animations = [
		{
			name: "move",
			samplers: [
				{ input: accessor, output: accessor + 1, interpolation: "LINEAR" },
			],
			channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
		},
	];
	model.buffers[0].byteLength = bin.length + data.length;
	const text = Buffer.from(JSON.stringify(model)),
		json = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
	text.copy(json);
	const header = Buffer.alloc(20),
		tail = Buffer.alloc(8);
	header.writeUInt32LE(0x46546c67);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(28 + json.length + bin.length + data.length, 8);
	header.writeUInt32LE(json.length, 12);
	header.writeUInt32LE(0x4e4f534a, 16);
	tail.writeUInt32LE(bin.length + data.length);
	tail.writeUInt32LE(0x004e4942, 4);
	return Buffer.concat([header, json, tail, bin, data]);
}

export async function run({
	root,
	toolchain,
}: {
	root: string;
	toolchain: string;
}) {
	const creator =
		"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized";
	const context = {
		store: new FileProjectStore({
			root: join(root, "project"),
			schemaVersion: 1,
		}),
		projectId: "pinned-features" as never,
	};
	const author = join(root, "author");
	await mkdir(author);
	for (const entry of ["glass-object-scene.ts", "model-feature-scene.ts"])
		await copyFile(join(creator, entry), join(author, entry));
	const fixtures = [
		{
			id: "assets/shape.svg",
			kind: "model",
			mimeType: "image/svg+xml",
			bytes: Buffer.from(
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"><path fill="#9ac9ef" fill-rule="evenodd" d="M10 10H110V90H10Z M40 35V65H80V35Z"/></svg>',
			),
		},
		{
			id: "assets/neutral.hdr",
			kind: "environment",
			mimeType: "image/vnd.radiance",
			bytes: threeEnvironment(false),
		},
		{
			id: "assets/animated.glb",
			kind: "model",
			mimeType: "model/gltf-binary",
			bytes: animatedModel(),
		},
	];
	const resources = [];
	for (const fixture of fixtures) {
		const filePath = join(root, fixture.id.split("/").pop()!);
		await writeFile(filePath, fixture.bytes, { flag: "wx" });
		resources.push(
			(
				await importProgrammaticResource({
					...context,
					input: {
						id: fixture.id,
						kind: fixture.kind,
						mimeType: fixture.mimeType,
						filePath,
					},
				})
			).resource,
		);
	}
	const { svgModelThree, modelThree } = await import(
		pathToFileURL(join(creator, "model-features.mjs")).href
	);
	const { glassSvgObjectThree } = await import(
		pathToFileURL(join(creator, "glass-svg-object.mjs")).href
	);
	const settings = { width: 320, height: 180, durationFrames: 60 };
	const cases = [
		{
			id: "svg",
			value: svgModelThree({
				sourceDirectory: author,
				svg: resources[0],
				modeling: { kind: "extrude", depth: 0.25 },
				curveSegments: 8,
				inputProps: { scale: 0.025, position: [-1.5, 1.25, 0] },
				environment: resources[1],
				settings,
			}),
		},
		{
			id: "animation",
			value: modelThree({
				sourceDirectory: author,
				model: resources[2],
				inputProps: {
					animation: { clip: "move", mode: "clamp", speed: 1, offset: 0 },
				},
				environment: resources[1],
				settings,
			}),
		},
		{
			id: "glass-svg",
			value: await glassSvgObjectThree({
				sourceDirectory: author,
				svg: resources[0],
				modeling: { kind: "extrude", depth: 0.25 },
				curveSegments: 8,
				environment: resources[1],
				settings,
				resolveParams: resolveGlassObjectParamsJson,
				inputProps: { scale: 0.025, position: [-1.5, 1.25, 0] },
			}),
		},
	];
	const results = [];
	for (const item of cases) {
		const compile = (action: "compile" | "rebuild", input: unknown) =>
			compileProgrammaticProject({
				action,
				input,
				toolchainDirectory: toolchain,
				context,
				signal: AbortSignal.timeout(30000),
				enqueue: async (task) => task(),
			});
		const result = await compile("compile", item.value.spec),
			source = result.source;
		assert.deepEqual(
			source.build?.inputs.map((input) => input.id),
			item.value.spec.files,
		);
		const archived = await loadProgrammaticResources(
			context,
			[
				...source.build!.inputs,
				source.build!.toolchainLock,
				...source.resources!,
			],
			new AbortController().signal,
		);
		const lock = JSON.parse(
			new TextDecoder().decode(
				archived.find(
					(input) => input.resource.id === source.build!.toolchainLock.id,
				)!.body,
			),
		);
		assert.equal(lock.threeAssetFeatures.profile, "svg-animation-v1");
		assert.equal(lock.threeAssetFeatures.files.length, 6);
		assert.equal(lock.threeAssetCodecs.profile, "offline-codecs-v1");
		assert(
			lock.packages.some(
				(pkg: { path: string; version: string }) =>
					pkg.path === "node_modules/@elftia/three-assets" &&
					pkg.version === "0.1.1",
			),
		);
		const input = archived.find(
			(input) => input.resource.id === item.value.spec.entryFile,
		)!;
		assert.deepEqual(
			Buffer.from(input.body),
			await readFile(join(author, item.value.spec.entryFile)),
		);
		const document = archived.find(
			(input) => input.resource.id === source.documentId,
		)!;
		assert(document.body.byteLength > 100000);
		assert(Buffer.from(document.body).includes(Buffer.from("async svg(")));
		const rebuild = await compile("rebuild", source);
		assert.deepEqual(rebuild.source, source);
		assert.equal(rebuild.reusedDocument, true);
		await writeFile(
			join(root, `${item.id}-source.json`),
			JSON.stringify(source, null, 2),
			{ flag: "wx" },
		);
		await writeFile(
			join(root, `${item.id}-compiled.html`),
			Buffer.from(document.body),
			{ flag: "wx" },
		);
		results.push({
			id: item.id,
			compiledBytes: document.body.byteLength,
			source,
			lock,
			archiveReadback: true,
			deterministicRebuild: true,
		});
	}
	await writeFile(
		join(root, "compile-receipt.json"),
		JSON.stringify(
			{
				ok: true,
				results,
				resourceSha256: fixtures.map((f) => ({
					id: f.id,
					sha256: createHash("sha256").update(f.bytes).digest("hex"),
				})),
				scope:
					"real imports/private WASM/Creator helpers/full compileProgrammaticProject + content-addressed archive/readback/deterministic rebuild; no GPU/browser/installed runtime",
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
}
