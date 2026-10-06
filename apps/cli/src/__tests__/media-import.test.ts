import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startHost } from "../host";
import { runCli } from "../main";
import { TargetRegistry } from "../target-registry";

const fixture = (name: string) =>
	fileURLToPath(
		new URL(`../../../vite-example/tests/fixtures/${name}`, import.meta.url),
	);

test("MV Agent CLI imports real files, composes lyrics/layers and reopens without source paths", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-media-import-"));
	const projectRoot = path.join(root, "mv");
	const registry = new TargetRegistry(path.join(root, "registry"));
	let host = await startHost({ projectRoot, registry });
	const cli = async (...args: string[]) => {
		const write = process.stdout.write;
		let output = "";
		process.stdout.write = ((chunk: string | Uint8Array) => {
			output += Buffer.from(chunk).toString();
			return true;
		}) as typeof process.stdout.write;
		try {
			await runCli([
				...args,
				"--target",
				host.targetId,
				"--targets-root",
				path.join(root, "registry"),
			]);
		} finally {
			process.stdout.write = write;
		}
		return JSON.parse(output);
	};
	const spec = async (name: string, value: unknown) => {
		const location = path.join(root, `${name}.json`);
		await writeFile(location, JSON.stringify(value), "utf8");
		return location;
	};
	const api = (route: string) =>
		`http://127.0.0.1:${host.port}/${host.token}/api/${route}`;
	try {
		expect((await cli("capabilities")).mediaImport).toMatchObject({
			createsTimelineClip: false,
		});
		const localSong = path.join(root, "song.wav");
		await writeFile(localSong, await readFile(fixture("fixture-tone-a4.wav")));
		const songSpec = await spec("song", {
			filePath: localSong,
			expectedRevision: 0,
			idempotencyKey: "mv-song",
		});
		const song = await cli("media", "import", songSpec);
		expect(song.asset).toMatchObject({ kind: "audio", hasAudio: true });
		expect(song.asset.duration).toBeGreaterThan(120000);
		expect(song.metadataSource).toBe("container");
		const imageSpec = await spec("image", {
			filePath: fixture("fixture-image.png"),
			expectedRevision: 1,
			idempotencyKey: "mv-background",
			image: { mimeType: "image/png", width: 320, height: 180 },
		});
		const picture = await cli("media", "import", imageSpec);
		expect(picture.asset).toMatchObject({
			kind: "image",
			width: 320,
			height: 180,
		});
		expect(picture.metadataSource).toBe("caller");
		const video = await cli(
			"media",
			"import",
			await spec("video", {
				filePath: fixture("fixture-video.mp4"),
				expectedRevision: 2,
				idempotencyKey: "mv-shot",
			}),
		);
		expect(video.asset).toMatchObject({
			kind: "video",
			width: 640,
			height: 360,
		});
		const state = await cli("read");
		const sceneId = state.projectEntity.sceneState.currentSceneId;
		const mainTrackId = state.projectEntity.sceneState.scenes.find(
			(s: { id: string }) => s.id === sceneId,
		).mainTrackId;
		await cli(
			"apply",
			await spec("layout", {
				expectedRevision: state.revision,
				idempotencyKey: "mv-layout",
				operations: [
					{
						kind: "create-track",
						track: {
							id: "mv-song-track",
							kind: "audio",
							name: "Song",
							hidden: false,
							sceneId,
						},
					},
					{
						kind: "create-clip",
						clip: {
							id: "mv-song-clip",
							trackId: "mv-song-track",
							assetId: song.asset.id,
							startTime: 0,
							duration: 120000,
							trimStart: 0,
							trimEnd: 0,
						},
					},
					{
						kind: "create-clip",
						clip: {
							id: "mv-bg",
							trackId: mainTrackId,
							assetId: picture.asset.id,
							startTime: 0,
							duration: 120000,
							trimStart: 0,
							trimEnd: 0,
							editing: { type: "image", params: { opacity: 0.8 } },
						},
					},
					{
						kind: "create-marker",
						marker: { id: "mv-chorus", sceneId, time: 0, note: "Chorus" },
					},
				],
			}),
		);
		const lyrics = await cli(
			"motion-text",
			"create",
			await spec("lyrics", {
				source: "[00:00.00]Hello\n[00:00.50]World",
				sourceFormat: "lrc",
				language: "en",
				duration: 120000,
				startTime: 0,
				starterPreset: "impact-title",
				seed: 7,
				expectedRevision: 4,
				idempotencyKey: "mv-lyrics",
			}),
		);
		expect(lyrics.sequenceId).toBeTruthy();
		expect((await cli("motion-text", "list")).sequences).toHaveLength(1);
		expect((await cli("read")).revision).toBe(5);
		const bytes = await (
			await fetch(api(`attachment/${song.asset.id}`))
		).arrayBuffer();
		expect(Buffer.from(bytes)).toEqual(
			await readFile(fixture("fixture-tone-a4.wav")),
		);
		await host.close();
		host = await startHost({ projectRoot, registry });
		expect((await cli("read")).entities.assets).toHaveLength(3);
		expect((await cli("media", "import", songSpec)).replayed).toBe(true);
		expect((await cli("read")).revision).toBe(5);
		await writeFile(localSong, await readFile(fixture("fixture-tone-a5.wav")));
		await expect(cli("media", "import", songSpec)).rejects.toThrow("409");
		// A new source or stale intent must not leave attachments behind.
		const before = await readdir(path.join(projectRoot, "attachments"));
		await expect(
			cli(
				"media",
				"import",
				await spec("stale", {
					filePath: fixture("fixture-tone-a5.wav"),
					expectedRevision: 0,
					idempotencyKey: "stale",
				}),
			),
		).rejects.toThrow("409");
		await expect(
			cli(
				"media",
				"import",
				await spec("changed-key", {
					filePath: fixture("fixture-tone-a5.wav"),
					expectedRevision: 5,
					idempotencyKey: "mv-song",
				}),
			),
		).rejects.toThrow("409");
		expect(await readdir(path.join(projectRoot, "attachments"))).toEqual(
			before,
		);
		expect((await cli("read")).revision).toBe(5);
		for (const invalid of [
			{ filePath: root },
			{ filePath: "relative.wav" },
			{ filePath: path.join(root, "missing.wav") },
			{
				filePath: fixture("fixture-image.png"),
				image: { mimeType: "image/png", width: 0, height: 180 },
			},
			{ filePath: fixture("fixture-tone-a4.wav"), arbitrary: true },
		]) {
			await expect(
				cli(
					"media",
					"import",
					await spec("invalid", {
						expectedRevision: 5,
						idempotencyKey: "invalid",
						...invalid,
					}),
				),
			).rejects.toThrow("409");
		}
		expect(await readdir(path.join(projectRoot, "attachments"))).toEqual(
			before,
		);
	} finally {
		await host.close();
		if (
			path.dirname(root) !== path.resolve(tmpdir()) ||
			!path.basename(root).startsWith("rocut-media-import-")
		)
			throw new Error("Unsafe cleanup");
		await rm(root, { recursive: true, force: true });
	}
});
