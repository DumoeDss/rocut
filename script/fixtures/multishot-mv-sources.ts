import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import {
	describeResource,
	saveResourceBytes,
} from "../../apps/cli/src/programmatic/resource-bytes";
import { resourceDigest } from "../../apps/cli/src/programmatic/resources";
import type { FileProjectStore } from "../../apps/cli/src/file-store";
import { multishotAudio } from "./multishot-mv-audio-fixture";

export async function multishotSources({
	root,
	toolchainDirectory,
	ffmpeg,
	context,
}: {
	root: string;
	toolchainDirectory: string;
	ffmpeg: string;
	context: { store: FileProjectStore; projectId: string };
}) {
	const audio = multishotAudio(),
		sources: Record<string, ProgrammaticSource> = {};
	await writeFile(join(root, "expected.f32"), audio.expected);
	await writeFile(join(root, "ordinary.wav"), audio.ordinary);
	for (const engine of ["hyperframes", "remotion"] as const) {
		const authored = join(root, engine),
			moved = join(root, `${engine}-moved`);
		await mkdir(authored);
		const entryFile = engine === "hyperframes" ? "index.html" : "index.tsx";
		await copyFile(
			fileURLToPath(
				new URL(
					`./multishot-mv-${engine}.${engine === "hyperframes" ? "html" : "tsx"}`,
					import.meta.url,
				),
			),
			join(authored, entryFile),
		);
		const files = [entryFile];
		if (engine === "hyperframes") {
			await copyFile(
				join(toolchainDirectory, "node_modules/gsap/dist/gsap.min.js"),
				join(authored, "gsap.js"),
			);
			await writeFile(join(authored, "music.wav"), audio.music);
			files.push("gsap.js", "music.wav");
		}
		const compiled = await compileProgrammaticProject({
			action: "compile",
			input: {
				version: 1,
				engine,
				sourceDirectory: authored,
				entryFile,
				files,
				width: 160,
				height: 90,
				frameRate: { numerator: 25, denominator: 1 },
				durationFrames: 150,
				seed: 11,
				...(engine === "remotion"
					? { compositionId: "MultishotMv" }
					: { audio: { version: 1, mode: "native", volumeDb: -6 } }),
			},
			toolchainDirectory,
			context,
			signal: AbortSignal.timeout(60000),
			enqueue: (task) => task(),
		});
		assert.equal(dirname(resolve(authored)), root);
		assert.equal(dirname(resolve(moved)), root);
		await rename(authored, moved);
		const rebuilt = await compileProgrammaticProject({
			action: "rebuild",
			input: JSON.parse(JSON.stringify(compiled.source)),
			toolchainDirectory,
			context,
			signal: AbortSignal.timeout(60000),
			enqueue: (task) => task(),
		});
		assert.equal(rebuilt.reusedDocument, true);
		sources[engine] = rebuilt.source;
	}
	async function image(id: string, foreground: boolean) {
		const raw = Buffer.alloc(160 * 90 * 4);
		for (let y = 0; y < 90; y++)
			for (let x = 0; x < 160; x++) {
				if (foreground && !(x >= 72 && x < 88 && y >= 29 && y < 61)) continue;
				raw.set(
					foreground ? [233, 69, 96, 255] : [255, 0, 255, 255],
					(y * 160 + x) * 4,
				);
			}
		const png = execFileSync(
			ffmpeg,
			[
				"-v",
				"error",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgba",
				"-s",
				"160x90",
				"-i",
				"pipe:0",
				"-frames:v",
				"1",
				"-f",
				"image2pipe",
				"-c:v",
				"png",
				"pipe:1",
			],
			{ input: raw, windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
		);
		await writeFile(join(root, id), png);
		const body = Uint8Array.from(png).buffer;
		const resource = describeResource(
			{ id, kind: "image", mimeType: "image/png" },
			body.byteLength,
			resourceDigest(body),
		);
		await saveResourceBytes(context, { resource, body });
		return resource;
	}
	const foreground = await image("foreground.png", true),
		omitted = await image("omitted-background.png", false);
	const pose = { x: 0.5, y: 0.5, height: 1, rotation: 0, opacity: 1 };
	sources.recipe = {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 160,
		height: 90,
		frameRate: { numerator: 25, denominator: 1 },
		durationFrames: 150,
		seed: 11,
		resources: [foreground, omitted],
		recipe: {
			version: 1,
			root: "foreground",
			songStartSeconds: 0,
			outputRoles: ["foreground"],
			nodes: [
				{
					id: "foreground",
					scene: {
						kind: "illust",
						motion: { startFrame: 0, durationFrames: 150 },
						easing: "linear",
						background: {
							image: omitted.id,
							from: { x: 0, y: 0, zoom: 1 },
							to: { x: 0, y: 0, zoom: 1 },
						},
						sprites: [
							{
								image: foreground.id,
								role: "foreground",
								from: pose,
								to: pose,
								anchor: [0.5, 0.5],
							},
						],
					},
				},
			],
		},
	};
	const archived = { hyperframes: true, remotion: true };
	await writeFile(
		join(root, "sources.json"),
		JSON.stringify({ sources, archived }, null, 2),
	);
	return {
		sources,
		archived,
		ordinary: audio.ordinary,
		expected: audio.expected,
	};
}
