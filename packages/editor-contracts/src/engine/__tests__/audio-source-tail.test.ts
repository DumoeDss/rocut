import { expect, test } from "bun:test";
import { createInMemoryProjectStoreFixture } from "@opencut/editor-ports/in-memory";
import {
	assetId,
	clipId,
	mediaTime,
	projectId,
	trackId,
	type Clip,
} from "../..";
import { openTransactionEngine } from "../engine";
import {
	createTransactionNativeDocumentAdapter,
	createTransactionNativeProjectSeed,
} from "../native-adapter";

test("an audio clip retains exact source EOF between frames across save/reopen", async () => {
	const { store } = createInMemoryProjectStoreFixture();
	const id = projectId("audio-tail");
	await store.save(
		createTransactionNativeProjectSeed({
			projectId: id,
			project: {
				id,
				name: "Audio tail",
				frameRate: { numerator: 30, denominator: 1 },
				canvasWidth: 1920,
				canvasHeight: 1080,
			},
		}),
	);
	const open = () =>
		openTransactionEngine({
			store,
			projectId: id,
			documentAdapter: createTransactionNativeDocumentAdapter(),
		});
	const engine = await open();
	await engine.apply({
		operations: [
			{
				kind: "create-track",
				track: {
					id: trackId("audio"),
					kind: "audio",
					name: "Song",
					hidden: false,
				},
			},
			{
				kind: "create-track",
				track: {
					id: trackId("video"),
					kind: "video",
					name: "Video",
					hidden: false,
				},
			},
			{
				kind: "create-asset",
				asset: {
					id: assetId("song"),
					kind: "audio",
					name: "4.12s song",
					duration: mediaTime({ ticks: 494400 }),
				},
			},
			{
				kind: "create-asset",
				asset: {
					id: assetId("video-source"),
					kind: "video",
					name: "Video",
					duration: mediaTime({ ticks: 494400 }),
				},
			},
		],
	});
	const song: Clip = {
		id: clipId("song-clip"),
		assetId: assetId("song"),
		trackId: trackId("audio"),
		startTime: mediaTime({ ticks: 0 }),
		duration: mediaTime({ ticks: 494400 }),
		trimStart: mediaTime({ ticks: 0 }),
		trimEnd: mediaTime({ ticks: 0 }),
	};
	const rejected = async ({
		patch,
		code,
	}: {
		patch: Partial<Clip>;
		code: string;
	}) => {
		const result = await engine.validate({
			operations: [{ kind: "create-clip", clip: { ...song, ...patch } }],
		});
		expect(result.valid).toBe(false);
		if (!result.valid)
			expect(result.issues.some((issue) => issue.code === code)).toBe(true);
	};
	await rejected({
		patch: { duration: mediaTime({ ticks: 494401 }) },
		code: "source-out-of-bounds",
	});
	await rejected({
		patch: { duration: mediaTime({ ticks: 490399 }) },
		code: "timebase-misaligned",
	});
	await rejected({
		patch: { startTime: mediaTime({ ticks: 1 }) },
		code: "timebase-misaligned",
	});
	await rejected({
		patch: { assetId: assetId("video-source"), trackId: trackId("video") },
		code: "timebase-misaligned",
	});
	await rejected({
		patch: { trackId: trackId("video") },
		code: "lane-incompatible",
	});
	await engine.apply({ operations: [{ kind: "create-clip", clip: song }] });
	expect(Number((await (await open()).clips())[0].duration)).toBe(494400);
});
