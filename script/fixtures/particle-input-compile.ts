import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { importProgrammaticResource } from "../../apps/cli/src/programmatic/resource-import";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { loadProgrammaticResources } from "../../apps/cli/src/programmatic/resources";
import { parseThreeParticleArchive } from "../../apps/cli/src/programmatic/three-particle-provenance";
import { particleAlphaPng, particlePoseGlb } from "./particle-input-resources";

const creator =
	"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized";
export async function runParticleInputCompile({
	root,
	toolchain,
	modes = ["image", "animated"],
}: {
	root: string;
	toolchain: string;
	modes?: ("image" | "animated")[];
}) {
	const results = [];
	for (const mode of modes) {
		const directory = join(root, mode),
			author = join(directory, "author");
		await mkdir(author, { recursive: true });
		const context = {
			store: new FileProjectStore({
				root: join(directory, "project"),
				schemaVersion: 1,
			}),
			projectId: `particle-${mode}` as never,
		};
		const bytes = mode === "image" ? particleAlphaPng() : particlePoseGlb(),
			filePath = join(directory, mode === "image" ? "alpha.png" : "pose.glb");
		await writeFile(filePath, bytes, { flag: "wx" });
		const resource = (
			await importProgrammaticResource({
				...context,
				input: {
					id: mode === "image" ? "assets/alpha.png" : "assets/pose.glb",
					kind: mode === "image" ? "image" : "model",
					mimeType: mode === "image" ? "image/png" : "model/gltf-binary",
					filePath,
				},
			})
		).resource;
		const helpers = await import(
			pathToFileURL(
				join(
					creator,
					mode === "image"
						? "particle-image.mjs"
						: "particle-animated-object.mjs",
				),
			).href
		);
		const helper =
			mode === "image"
				? helpers.particleImageThree
				: helpers.particleAnimatedThree;
		assert.equal(typeof helper, "function");
		const value = await helper({
			sourceDirectory: author,
			settings: {
				width: 64,
				height: 64,
				durationFrames: 30,
				frameRate: { numerator: 30, denominator: 1 },
				seed: 19,
			},
			inputProps: {
				count: 32,
				...(mode === "animated"
					? { animation: { clip: "pose", mode: "clamp", speed: 1, offset: 0 } }
					: {}),
			},
			...(mode === "image"
				? { image: resource, plane: { width: 2, height: 2 }, alphaTest: 0.1 }
				: { model: resource }),
		});
		for (const file of value.spec.files)
			await copyFile(join(creator, file), join(author, file));
		const compile = (action: "compile" | "rebuild", input: unknown) =>
			compileProgrammaticProject({
				action,
				input,
				toolchainDirectory: toolchain,
				context,
				signal: AbortSignal.timeout(30000),
				enqueue: async (task) => task(),
			});
		const result = await compile("compile", value.spec),
			source = result.source;
		assert.deepEqual(source.build!.capabilities, ["particle-surface-v1"]);
		const archived = await loadProgrammaticResources(
			context,
			[
				...source.build!.inputs,
				source.build!.toolchainLock,
				...source.resources!,
			],
			new AbortController().signal,
		);
		const lockBody = archived.find(
				(item) => item.resource.id === source.build!.toolchainLock.id,
			)!.body,
			lock = JSON.parse(new TextDecoder().decode(lockBody)),
			identity = parseThreeParticleArchive(source, lockBody);
		assert(identity);
		assert.equal(identity.adapterSha256, lock.adapter.sha256);
		for (const input of source.build!.inputs)
			assert.deepEqual(
				Buffer.from(
					archived.find((item) => item.resource.id === input.id)!.body,
				),
				await readFile(join(author, input.id)),
			);
		assert.deepEqual(
			Buffer.from(
				archived.find((item) => item.resource.id === resource.id)!.body,
			),
			bytes,
		);
		const document = archived.find(
			(item) => item.resource.id === source.documentId,
		)!;
		assert(document.body.byteLength > 100000);
		if (mode === "animated") {
			assert.equal(lock.threeAssetFeatures.profile, "svg-animation-v1");
			assert.equal(lock.threeAssetFeatures.files.length, 6);
		}
		await rename(author, join(directory, "author-unavailable"));
		await rename(filePath, join(directory, "original-unavailable"));
		const rebuilt = await compile("rebuild", source);
		assert.deepEqual(rebuilt.source, source);
		assert.equal(rebuilt.reusedDocument, true);
		await writeFile(
			join(directory, "source.json"),
			JSON.stringify(source, null, 2),
			{ flag: "wx" },
		);
		await writeFile(
			join(directory, "compiled.html"),
			Buffer.from(document.body),
			{ flag: "wx" },
		);
		results.push({
			mode,
			compiledBytes: document.body.byteLength,
			identity,
			lock,
			resource,
			archiveBytesVerified: true,
			authorAndOriginalMoved: true,
			archiveOnlyRebuild: true,
		});
	}
	const receipt = {
		ok: true,
		root,
		toolchain,
		results,
		scope:
			"real imported helper/private Rust resource admission/native worker/full compileProgrammaticProject/archive readback/archive-only rebuild; no author JS execution/GPU/runtime scene rendering",
	};
	await writeFile(
		join(root, "receipt.json"),
		JSON.stringify(receipt, null, 2),
		{ flag: "wx" },
	);
	return receipt;
}
