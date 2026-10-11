import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveLiquidObjectParamsJson } from "opencut-wasm";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { importProgrammaticResource } from "../../apps/cli/src/programmatic/resource-import";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { loadProgrammaticResources } from "../../apps/cli/src/programmatic/resources";
import { parseThreeParticleArchive } from "../../apps/cli/src/programmatic/three-particle-provenance";
import { parseThreeLiquidObjectArchive } from "../../apps/cli/src/programmatic/three-liquid-object-provenance";

const creator =
	"E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized";
export async function runThreeNativeSvgBuild({
	root,
	toolchain,
	legacyToolchain,
}: {
	root: string;
	toolchain: string;
	legacyToolchain: string;
}) {
	const particle = await import(
			pathToFileURL(join(creator, "particle-object.mjs")).href
		),
		liquid = await import(
			pathToFileURL(join(creator, "liquid-object.mjs")).href
		);
	const svgHelpers = await import(
		pathToFileURL(join(creator, "native-svg-objects.mjs")).href
	);
	assert.equal(typeof svgHelpers.particleSvgThree, "function");
	assert.equal(typeof svgHelpers.liquidSvgObjectThree, "function");
	const results = [];
	for (const kind of ["particle", "liquid"])
		for (const mode of ["flat", "extrude", "legacy-glb"]) {
			const id = `${kind}-${mode}`,
				directory = join(root, id);
			await mkdir(directory);
			const author = join(directory, "author");
			await mkdir(author);
			const context = {
				store: new FileProjectStore({
					root: join(directory, "project"),
					schemaVersion: 1,
				}),
				projectId: id as never,
			};
			const isSvg = mode !== "legacy-glb",
				filePath = join(directory, isSvg ? "hole.svg" : "static.glb");
			const bytes = isSvg
				? Buffer.from(
						'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#8ec5ee" fill-rule="evenodd" d="M5 5H95V95H5Z M30 30V70H70V30Z"/></svg>',
					)
				: await readFile(
						"C:/tmps/rocut-three-pinned-features-ZvqmB9/animated.glb",
					);
			await writeFile(filePath, bytes, { flag: "wx" });
			const resource = (
				await importProgrammaticResource({
					...context,
					input: {
						id: isSvg ? "assets/hole.svg" : "assets/static.glb",
						kind: "model",
						mimeType: isSvg ? "image/svg+xml" : "model/gltf-binary",
						filePath,
					},
				})
			).resource;
			const options = {
				sourceDirectory: author,
				settings: {
					width: 64,
					height: 64,
					durationFrames: 30,
					frameRate: { numerator: 30, denominator: 1 },
					seed: 19,
				},
				inputProps: kind === "particle" ? { count: 32 } : {},
				...(kind === "liquid"
					? { resolveParams: resolveLiquidObjectParamsJson }
					: {}),
				...(isSvg
					? {
							svg: resource,
							modeling:
								mode === "flat"
									? { kind: "flat" }
									: { kind: "extrude", depth: 0.25 },
							curveSegments: 8,
						}
					: { model: resource }),
			};
			const helper =
					kind === "particle"
						? isSvg
							? svgHelpers.particleSvgThree
							: particle.particleThree
						: isSvg
							? svgHelpers.liquidSvgObjectThree
							: liquid.liquidObjectThree,
				value = await helper(options);
			for (const file of value.spec.files)
				await copyFile(join(creator, file), join(author, file));
			const compile = (
				action: "compile" | "rebuild",
				input: unknown,
				selected = toolchain,
			) =>
				compileProgrammaticProject({
					action,
					input,
					toolchainDirectory: selected,
					context,
					signal: AbortSignal.timeout(30000),
					enqueue: async (task) => task(),
				});
			const selected = isSvg ? toolchain : legacyToolchain,
				result = await compile("compile", value.spec, selected),
				source = result.source;
			assert.deepEqual(source.build!.capabilities, [
				kind === "particle" ? "particle-surface-v1" : "liquid-object-v1",
			]);
			const archived = await loadProgrammaticResources(
					context,
					[
						...source.build!.inputs,
						source.build!.toolchainLock,
						...source.resources!,
					],
					new AbortController().signal,
				),
				lockBody = archived.find(
					(item) => item.resource.id === source.build!.toolchainLock.id,
				)!.body,
				lock = JSON.parse(new TextDecoder().decode(lockBody));
			assert.equal(Boolean(lock.threeAssetFeatures), isSvg);
			if (isSvg) {
				assert.equal(lock.threeAssetFeatures.profile, "svg-animation-v1");
				assert.equal(lock.threeAssetFeatures.files.length, 6);
			}
			const identity =
				kind === "particle"
					? parseThreeParticleArchive(source, lockBody)
					: parseThreeLiquidObjectArchive({ source, body: lockBody });
			assert(identity);
			assert.equal(identity.adapterSha256, lock.adapter.sha256);
			for (const input of source.build!.inputs) {
				assert.deepEqual(
					Buffer.from(
						archived.find((item) => item.resource.id === input.id)!.body,
					),
					await readFile(join(author, input.id)),
				);
			}
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
			if (isSvg)
				assert(
					Buffer.from(document.body).includes(Buffer.from("async svg(")),
					"Real native document must contain the fixed SVG asset API",
				);
			if (isSvg)
				await assert.rejects(
					compile("compile", value.spec, legacyToolchain),
					/SVG models require|asset feature|feature profile/i,
				);
			await rename(author, join(directory, "author-unavailable"));
			await rename(filePath, join(directory, "original-unavailable"));
			const rebuilt = await compile("rebuild", source, selected);
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
				id,
				compiledBytes: document.body.byteLength,
				identity,
				lock,
				archiveBytesVerified: true,
				authorAndOriginalMoved: true,
				archiveOnlyRebuild: true,
				legacySvgRejected: isSvg,
			});
		}
	for (const kind of ["particle", "liquid"]) {
		const svg = results.find((item) => item.id === `${kind}-flat`)!,
			glb = results.find((item) => item.id === `${kind}-legacy-glb`)!;
		assert.notEqual(
			svg.identity!.adapterSha256,
			glb.identity!.adapterSha256,
			"Effective native SVG driver identity must differ from legacy GLB",
		);
	}
	const receipt = {
		ok: true,
		root,
		toolchain,
		legacyToolchain,
		results,
		scope:
			"real private Rust resource admission/resolver/native worker publications + complete compileProgrammaticProject/archive readback/archive-only rebuild; no author JS execution/render/GPU",
	};
	await writeFile(
		join(root, "receipt.json"),
		JSON.stringify(receipt, null, 2),
		{ flag: "wx" },
	);
	return receipt;
}
