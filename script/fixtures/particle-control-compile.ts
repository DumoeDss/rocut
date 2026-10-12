import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { importProgrammaticResource } from "../../apps/cli/src/programmatic/resource-import";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { loadProgrammaticResources } from "../../apps/cli/src/programmatic/resources";
import { parseThreeParticleArchive } from "../../apps/cli/src/programmatic/three-particle-provenance";
import { particlePoseGlb } from "./particle-input-resources";
import { springControl } from "./particle-control-cases";
import { createParticleSamplerWorker } from "../../apps/cli/src/programmatic/particle-sampler-worker";
import { getProgrammaticParticleMotionControlCapability } from "../../apps/cli/src/programmatic/particle-motion-control-capability";
import { controlBase, controlMotion } from "./particle-control-cases";
import { sampleParticleSurfaceJson } from "opencut-wasm";

const creator =
	"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized";
export async function runParticleControlCompile({
	root,
	toolchain,
}: {
	root: string;
	toolchain: string;
}) {
	const capability = getProgrammaticParticleMotionControlCapability();
	assert.equal(
		capability.available,
		true,
		"Actual new core must report control support",
	);
	const worker = await createParticleSamplerWorker({
		bootstrapTimeoutMs: 5000,
		signal: AbortSignal.timeout(15000),
	});
	const requestJson = JSON.stringify({
		...controlBase,
		motion: { ...controlMotion, timeTicks: 1000, control: springControl },
	});
	let workerIdentity;
	try {
		const actual = await worker.sampler(
			requestJson,
			AbortSignal.timeout(15000),
		);
		assert.equal(actual, sampleParticleSurfaceJson(requestJson));
		assert.equal(JSON.parse(actual).ok, true);
		const invalid = JSON.parse(
			await worker.sampler(
				JSON.stringify({
					...controlBase,
					motion: {
						...controlMotion,
						timeTicks: 1000,
						control: { ...springControl, radius: 0 },
					},
				}),
				AbortSignal.timeout(15000),
			),
		);
		assert.equal(invalid.ok, false);
		assert.equal(invalid.samples, undefined);
		workerIdentity = worker.samplerIdentity;
	} finally {
		await worker.terminateSampler();
	}
	await assert.rejects(worker.sampler(requestJson, AbortSignal.timeout(15000)));
	const author = join(root, "author");
	await mkdir(author);
	const context = {
		store: new FileProjectStore({
			root: join(root, "project"),
			schemaVersion: 1,
		}),
		projectId: "particle-controlled" as never,
	};
	const bytes = particlePoseGlb(),
		filePath = join(root, "pose.glb");
	await writeFile(filePath, bytes, { flag: "wx" });
	const model = (
		await importProgrammaticResource({
			...context,
			input: {
				id: "assets/pose.glb",
				kind: "model",
				mimeType: "model/gltf-binary",
				filePath,
			},
		})
	).resource;
	const { particleControlledThree } = await import(
		pathToFileURL(join(creator, "particle-controlled-object.mjs")).href
	);
	const control = structuredClone(springControl),
		value = await particleControlledThree({
			sourceDirectory: author,
			model,
			control,
			settings: {
				width: 64,
				height: 64,
				durationFrames: 30,
				frameRate: { numerator: 30, denominator: 1 },
				seed: 19,
			},
			inputProps: { count: 32 },
		});
	assert.deepEqual(value.spec.inputProps.motion.control, control);
	control.knots[0].position[0] = 999;
	assert.equal(value.spec.inputProps.motion.control.knots[0].position[0], 2);
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
	const { source } = await compile("compile", value.spec);
	assert.deepEqual(source.build!.capabilities, ["particle-surface-v1"]);
	assert.deepEqual(
		(source.build!.inputProps as { motion: { control: unknown } }).motion
			.control,
		springControl,
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
	const lockBody = archived.find(
			(item) => item.resource.id === source.build!.toolchainLock.id,
		)!.body,
		lock = JSON.parse(new TextDecoder().decode(lockBody)),
		identity = parseThreeParticleArchive(source, lockBody);
	assert(identity);
	assert.equal(identity.adapterSha256, lock.adapter.sha256);
	assert.notEqual(
		identity.adapterSha256,
		"14de66da41e5d6dce7fe114de47747d71dc1dd3cfd1939cdc271ea2ebdac3140",
		"Fresh build must use refreshed embedded control transport, never upgrade a legacy archive silently",
	);
	for (const input of source.build!.inputs)
		assert.deepEqual(
			Buffer.from(archived.find((item) => item.resource.id === input.id)!.body),
			await readFile(join(author, input.id)),
		);
	assert.deepEqual(
		Buffer.from(archived.find((item) => item.resource.id === model.id)!.body),
		bytes,
	);
	const document = archived.find(
		(item) => item.resource.id === source.documentId,
	)!;
	assert(document.body.byteLength > 100000);
	await rename(author, join(root, "author-unavailable"));
	await rename(filePath, join(root, "original-unavailable"));
	const rebuilt = await compile("rebuild", source);
	assert.deepEqual(rebuilt.source, source);
	assert.equal(rebuilt.reusedDocument, true);
	await writeFile(join(root, "source.json"), JSON.stringify(source, null, 2), {
		flag: "wx",
	});
	await writeFile(join(root, "compiled.html"), Buffer.from(document.body), {
		flag: "wx",
	});
	const receipt = {
		ok: true,
		root,
		toolchain,
		compiledBytes: document.body.byteLength,
		identity,
		capability,
		workerIdentity,
		workerControlResultExact: true,
		workerInvalidControlRejected: true,
		workerTerminated: true,
		lock,
		control: springControl,
		archiveBytesVerified: true,
		authorAndOriginalMoved: true,
		archiveOnlyRebuild: true,
		scope:
			"actual helper/full compileProgrammaticProject/native worker/archives; no author scene execution/GPU",
	};
	await writeFile(
		join(root, "compile-receipt.json"),
		JSON.stringify(receipt, null, 2),
		{ flag: "wx" },
	);
	return receipt;
}
