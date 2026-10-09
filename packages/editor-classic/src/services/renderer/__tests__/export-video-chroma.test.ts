import { afterEach, expect, test } from "bun:test";
import { ExportCancelledError } from "../export-cancellation";
import { resolveHighChromaVideoOptions } from "../export-video-chroma";

const originalEncoder = Object.getOwnPropertyDescriptor(
	globalThis,
	"VideoEncoder",
);
const request = {
	width: 192,
	height: 128,
	bitrate: 369000,
	frameRate: 30,
	fullCodecString: "vp09.01.11.08.03.01.13.01.01",
};

function installProbe(
	probe: (config: VideoEncoderConfig) => Promise<VideoEncoderSupport>,
) {
	Object.defineProperty(globalThis, "VideoEncoder", {
		configurable: true,
		value: { isConfigSupported: probe },
	});
}

afterEach(() => {
	if (originalEncoder)
		Object.defineProperty(globalThis, "VideoEncoder", originalEncoder);
	else Reflect.deleteProperty(globalThis, "VideoEncoder");
});

test("high-chroma probes the exact full codec, dimensions, budget and rational frame rate", async () => {
	const seen: VideoEncoderConfig[] = [];
	installProbe(async (config) => {
		seen.push(config);
		return { supported: true, config: { ...config } };
	});
	expect(
		await resolveHighChromaVideoOptions({
			...request,
			frameRate: 30000 / 1001,
		}),
	).toEqual({
		codec: "vp9",
		bitrate: 369000,
		fullCodecString: request.fullCodecString,
		hardwareAcceleration: "prefer-software",
	});
	expect(seen).toEqual([
		{
			codec: request.fullCodecString,
			width: 192,
			height: 128,
			bitrate: 369000,
			framerate: 30000 / 1001,
			hardwareAcceleration: "prefer-software",
			latencyMode: "quality",
		},
	]);
});

test("unsupported and throwing queries reject without negotiating a different profile", async () => {
	let calls = 0;
	installProbe(async (config) => {
		calls++;
		return { supported: false, config };
	});
	await expect(resolveHighChromaVideoOptions(request)).rejects.toThrow(
		"not supported",
	);
	expect(calls).toBe(1);
	installProbe(async () => {
		throw new Error("encoder offline");
	});
	await expect(resolveHighChromaVideoOptions(request)).rejects.toThrow(
		"encoder offline",
	);
});

test("partial or downgraded capability echoes cannot satisfy a high-chroma request", async () => {
	for (const key of [
		"codec",
		"width",
		"height",
		"bitrate",
		"framerate",
		"hardwareAcceleration",
		"latencyMode",
	] as const) {
		installProbe(async (config) => {
			const partial = { ...config };
			Reflect.deleteProperty(partial, key);
			return { supported: true, config: partial };
		});
		await expect(resolveHighChromaVideoOptions(request)).rejects.toThrow(
			`changed ${key}`,
		);
	}
	installProbe(async (config) => ({
		supported: true,
		config: { ...config, codec: "vp09.00.11.08" },
	}));
	await expect(resolveHighChromaVideoOptions(request)).rejects.toThrow(
		"changed codec",
	);
});

test("missing native encoder and invalid probe deadlines fail closed", async () => {
	Reflect.deleteProperty(globalThis, "VideoEncoder");
	await expect(resolveHighChromaVideoOptions(request)).rejects.toThrow(
		"requires WebCodecs",
	);
	for (const duration of [0, -1, 10001, NaN, Infinity, 0.5])
		await expect(
			resolveHighChromaVideoOptions({ ...request, probeTimeoutMs: duration }),
		).rejects.toThrow("deadline");
});

test("pre-cancelled requests never query the encoder", async () => {
	let calls = 0;
	installProbe(async (config) => {
		calls++;
		return { supported: true, config };
	});
	const controller = new AbortController();
	controller.abort();
	await expect(
		resolveHighChromaVideoOptions({ ...request, signal: controller.signal }),
	).rejects.toThrow(ExportCancelledError);
	expect(calls).toBe(0);
});

test("pending capability queries cancel promptly and ignore a late rejection", async () => {
	let rejectProbe!: (error: Error) => void;
	installProbe(
		() =>
			new Promise((_, reject) => {
				rejectProbe = reject;
			}),
	);
	const controller = new AbortController();
	const pending = resolveHighChromaVideoOptions({
		...request,
		signal: controller.signal,
	});
	controller.abort();
	controller.abort();
	await expect(pending).rejects.toThrow(ExportCancelledError);
	rejectProbe(new Error("late native error"));
	await Bun.sleep(0);
});

test("deadline settles a stalled probe and ignores a later successful echo", async () => {
	let release!: () => void;
	installProbe(
		(config) =>
			new Promise((resolve) => {
				release = () => resolve({ supported: true, config });
			}),
	);
	const pending = resolveHighChromaVideoOptions({
		...request,
		probeTimeoutMs: 15,
	});
	await expect(pending).rejects.toThrow("timed out");
	release();
	await Bun.sleep(0);
	await expect(pending).rejects.toThrow("timed out");
});
