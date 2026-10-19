/* eslint-disable opencut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion */
import { expect, mock, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.env.EDITOR_REVERSE_PIPELINE_TEST !== "1") {
	test.skipIf(!process.env.EDITOR_REVERSE_WASM_DIR)(
		"reverse pipeline runs against the private native runtime",
		() => {
			const result = Bun.spawnSync({
				cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
				cwd: process.cwd(),
				env: { ...process.env, EDITOR_REVERSE_PIPELINE_TEST: "1" },
				stdout: "pipe",
				stderr: "pipe",
			});
			if (result.exitCode !== 0)
				throw new Error(result.stdout.toString() + result.stderr.toString());
		},
	);
} else {
	const native = await import(
		pathToFileURL(
			join(process.env.EDITOR_REVERSE_WASM_DIR!, "opencut_wasm_sync.js"),
		).href
	);
	mock.module("opencut-wasm", () => native);
	await import("../../editor/session/__tests__/wasm-test-mock");
	const baseline = { ...(await import("opencut-wasm")) };
	mock.module("opencut-wasm", () => ({
		...baseline,
		resolveDirectionalVideoSourceTime: native.resolveDirectionalVideoSourceTime,
		reverseAudioSamples: native.reverseAudioSamples,
		directionalSourceTrims: native.directionalSourceTrims,
	}));
	const { resolveVideoSourceTime, directionalSourceTrims } =
		await import("../../wasm/video-time");
	const { mediaTime } = await import("../../wasm/media-time");
	const { renderRetimedBuffer } = await import("../../retime/audio-stretch");
	const { resolveFilmstripSourceTime } = await import("../filmstrip-source");
	const ticks = (value: number) => mediaTime({ ticks: value });
	test("main picture and blurred backdrop request the same reverse source frame", async () => {
		const { resolveVideoNode, resolveBlurBackgroundNode } =
			await import("../../services/renderer/resolve-picture");
		const { VideoNode } =
			await import("../../services/renderer/nodes/video-node");
		const { BlurBackgroundNode } =
			await import("../../services/renderer/nodes/blur-background-node");
		const calls: number[] = [];
		const context = {
			time: 60000,
			videoCache: {
				getFrameAt: async ({ time }: { time: number }) => {
					calls.push(time);
					return null;
				},
			},
		} as never;
		const params = {
			mediaId: "source",
			file: new File([], "source.mp4"),
			url: "blob:test",
			timeOffset: 0,
			duration: 120000,
			trimStart: 240000,
			trimEnd: 0,
			retime: { rate: 2, reverse: true },
			opacity: 1,
			transform: { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 },
		};
		await resolveVideoNode({ node: new VideoNode(params), context });
		await resolveBlurBackgroundNode({
			node: new BlurBackgroundNode({
				...params,
				mediaType: "video",
				blurIntensity: 10,
			}),
			context,
		});
		expect(calls).toEqual([359999 / 120000, 359999 / 120000]);
	});
	test("reverse resize consumes opposite source handles on both edges", async () => {
		const { computeGroupResize } =
			await import("../../timeline/group-resize/compute-resize");
		const member = {
			trackId: "main-track",
			elementId: "clip",
			startTime: ticks(120000),
			duration: ticks(120000),
			trimStart: ticks(240000),
			trimEnd: ticks(240000),
			sourceDuration: ticks(720000),
			retime: { rate: 2, reverse: true },
			leftNeighborBound: null,
			rightNeighborBound: null,
		};
		const resize = (side: "left" | "right") =>
			computeGroupResize({
				members: [member],
				side,
				deltaTime: ticks(60000),
				fps: { numerator: 30, denominator: 1 },
			}).updates[0].patch;
		expect(resize("left")).toEqual({
			startTime: 180000,
			duration: 60000,
			trimStart: 240000,
			trimEnd: 360000,
		});
		expect(resize("right")).toEqual({
			startTime: 120000,
			duration: 180000,
			trimStart: 120000,
			trimEnd: 240000,
		});
	});
	test("reverse survives durable save, reopen, undo, redo and split", async () => {
		const { commandHarness } =
			await import("../../core/managers/__tests__/command-test-harness");
		const { projectFixture, TEST_PROJECT_ID } =
			await import("../../editor/transactions/opencut/__tests__/fixture");
		const { decodeProject } =
			await import("../../editor/persistence/project-codec");
		const project = projectFixture();
		project.scenes[0].tracks.main.elements.push({
			id: "clip",
			name: "Clip",
			type: "video",
			mediaId: "source",
			startTime: ticks(0),
			duration: ticks(120000),
			trimStart: ticks(240000),
			trimEnd: ticks(240000),
			sourceDuration: ticks(720000),
			params: {},
			retime: { rate: 2 },
		});
		const h = await commandHarness(project, [
			{
				id: "source",
				name: "video.mp4",
				type: "video",
				duration: 6,
				hasAudio: true,
				file: new File([], "video.mp4", { type: "video/mp4" }),
			},
		]);
		const { UpdateElementsCommand } =
			await import("../../commands/timeline/element/update-elements");
		await h.command.execute({
			command: new UpdateElementsCommand({
				updates: [
					{
						trackId: "main-track",
						elementId: "clip",
						patch: { retime: { rate: 2, reverse: true } },
					},
				],
			}),
		});
		const current = () => {
			const element = h.getScenes()[0].tracks.main.elements[0];
			if (element.type !== "video") throw new Error("Expected video");
			return element;
		};
		expect(current().retime?.reverse).toBe(true);
		const record = await h.fixture.store.load({ id: TEST_PROJECT_ID });
		const restored = decodeProject(record?.data).scenes[0].tracks.main
			.elements[0];
		expect(restored.type === "video" && restored.retime?.reverse).toBe(true);
		await h.command.undo();
		expect(current().retime?.reverse).toBeUndefined();
		await h.command.redo();
		expect(current().retime?.reverse).toBe(true);
		await h.timeline.splitElements({
			elements: [{ trackId: "main-track", elementId: "clip" }],
			splitTime: ticks(60000),
			retainSide: "both",
		});
		const halves = h.getScenes()[0].tracks.main.elements;
		expect(halves).toHaveLength(2);
		expect(
			halves.map((element) => {
				if (element.type !== "video") throw new Error("Expected video");
				return [element.trimStart, element.trimEnd, element.retime?.reverse];
			}),
		).toEqual([
			[360000, 240000, true],
			[240000, 360000, true],
		]);
	});
	test("reverse filmstrip uses the same source frame across zoom levels", () => {
		const element = {
			id: "reverse",
			mediaId: "source",
			name: "Reverse",
			type: "video" as const,
			params: {},
			startTime: ticks(0),
			duration: ticks(120000),
			trimStart: ticks(240000),
			trimEnd: ticks(0),
			sourceDuration: ticks(720000),
			retime: { rate: 2, reverse: true },
		};
		expect(
			resolveFilmstripSourceTime({ element, offset: 25, pixelsPerSecond: 50 }),
		).toBe(359999);
		expect(
			resolveFilmstripSourceTime({ element, offset: 50, pixelsPerSecond: 100 }),
		).toBe(359999);
	});
	test("reverse source mapping retains the trimmed interval at positive speed", () => {
		const options = {
			clipDuration: 120000,
			trimStart: 240000,
			playbackRate: 2,
			reverse: true,
		};
		expect(resolveVideoSourceTime({ ...options, clipTime: 0 })).toBe(479999);
		expect(resolveVideoSourceTime({ ...options, clipTime: 60000 })).toBe(
			359999,
		);
		expect(resolveVideoSourceTime({ ...options, clipTime: 120000 })).toBeNull();
		expect(
			resolveVideoSourceTime({
				...options,
				clipTime: 60000,
				freezeFrame: 300000,
			}),
		).toBe(300000);
		const trims = {
			trimStart: ticks(240000),
			trimEnd: ticks(360000),
			reverse: true,
		};
		expect(
			directionalSourceTrims({
				...directionalSourceTrims(trims),
				reverse: true,
			}),
		).toEqual({ trimStart: trims.trimStart, trimEnd: trims.trimEnd });
	});
	function buffer(channels: number[][], sampleRate = 8): AudioBuffer {
		const data = channels.map((values) => Float32Array.from(values));
		return {
			sampleRate,
			length: data[0].length,
			duration: data[0].length / sampleRate,
			numberOfChannels: data.length,
			getChannelData: (channel: number) => data[channel],
			copyToChannel: (values: Float32Array, channel: number) =>
				data[channel].set(values),
		} as AudioBuffer;
	}
	test("prepared reverse audio reverses each channel after speed and trim", async () => {
		const sourceBuffer = buffer([
			Array.from({ length: 24 }, (_, i) => i),
			Array.from({ length: 24 }, (_, i) => -i),
		]);
		const audioContext = {
			sampleRate: 8,
			createBuffer: (channels: number, length: number, rate: number) =>
				buffer(
					Array.from({ length: channels }, () => Array(length).fill(0)),
					rate,
				),
		} as unknown as BaseAudioContext;
		const result = await renderRetimedBuffer({
			audioContext,
			sourceBuffer,
			trimStart: 0.5,
			clipDuration: 1,
			retime: { rate: 2, reverse: true },
			maintainPitch: false,
		});
		expect(Array.from(result.getChannelData(0))).toEqual([
			18, 16, 14, 12, 10, 8, 6, 4,
		]);
		expect(Array.from(result.getChannelData(1))).toEqual([
			-18, -16, -14, -12, -10, -8, -6, -4,
		]);
		const { mixAudioChannels } = await import("../audio-mix");
		const clip = {
			timelineElement: { type: "audio", params: {} } as never,
			buffer: result,
			startTime: 0,
			duration: 1,
			trimStart: 0,
			trimEnd: 0,
			volume: 1,
			muted: false,
		};
		const mix = (start: number, length: number) => {
			const outputBuffer = buffer([
				Array(length).fill(0),
				Array(length).fill(0),
			]);
			mixAudioChannels({
				element: clip,
				buffer: result,
				trimStart: 0,
				outputBuffer,
				outputLength: length,
				sampleRate: 8,
				outputStartTime: start,
			});
			return outputBuffer;
		};
		const full = mix(0, 8);
		const partial = mix(0.25, 4);
		for (let channel = 0; channel < 2; channel++)
			expect(partial.getChannelData(channel)).toEqual(
				full.getChannelData(channel).subarray(2, 6),
			);
	});
}
