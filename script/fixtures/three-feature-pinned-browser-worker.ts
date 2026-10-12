import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import { loadProgrammaticResources } from "../../apps/cli/src/programmatic/resources";

export async function run({
	root,
	archiveRoot,
	executable,
	observe,
}: {
	root: string;
	archiveRoot: string;
	executable: string;
	observe: () => unknown;
}) {
	const receipt = JSON.parse(
		await readFile(join(archiveRoot, "compile-receipt.json"), "utf8"),
	);
	const resourceStore = {
		store: new FileProjectStore({
			root: join(archiveRoot, "project"),
			schemaVersion: 1,
		}),
		projectId: "pinned-features" as never,
	};
	const results = [];
	for (const item of receipt.results) {
		const source = item.source;
		if (item.id === "animation") {
			const model = source.resources.find(
				(resource: { id: string }) => resource.id === "assets/animated.glb",
			);
			const [loaded] = await loadProgrammaticResources(
				resourceStore,
				[model],
				new AbortController().signal,
			);
			const bytes = Buffer.from(loaded!.body),
				length = bytes.readUInt32LE(12);
			const gltf = JSON.parse(bytes.subarray(20, 20 + length).toString("utf8"));
			assert.equal(gltf.animations[0].name, "move");
			assert.equal(gltf.animations[0].channels[0].target.path, "translation");
			assert.equal(source.build.inputProps.animation.clip, "move");
			assert.deepEqual(source.build.inputProps.rotationSpeed, [0, 0, 0]);
		}
		const frames = [];
		for (const ticks of [0, 120000, 0]) {
			const png = await renderHtmlPng({
				executable,
				resourceStore,
				request: {
					source,
					clipStart: 0,
					clipDuration: 240000,
					trimStart: 0,
					timelineTime: ticks,
				},
				signal: AbortSignal.timeout(20000),
			});
			assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
			assert.equal(png.readUInt32BE(16), 320);
			assert.equal(png.readUInt32BE(20), 180);
			const name = `${item.id}-${frames.length}-${ticks}.png`;
			await writeFile(join(root, name), png, { flag: "wx" });
			frames.push({
				ticks,
				path: name,
				bytes: png.length,
				sha256: createHash("sha256").update(png).digest("hex"),
			});
		}
		assert.equal(
			frames[0]!.sha256,
			frames[2]!.sha256,
			"Reverse absolute seek differs",
		);
		if (item.id === "animation")
			assert.notEqual(
				frames[0]!.sha256,
				frames[1]!.sha256,
				"Actual GLB clip did not move",
			);
		results.push({
			id: item.id,
			frames,
			deterministicReturn: true,
			actualClipMovement: item.id === "animation" ? true : undefined,
		});
		console.log(JSON.stringify({ stage: "captured", id: item.id, frames }));
	}
	return {
		ok: true,
		results,
		processes: observe(),
		scope:
			"actual production renderHtmlPng/private Chrome/archive resources; absolute 0→1s→0; no encoded output or pixel oracle",
	};
}
