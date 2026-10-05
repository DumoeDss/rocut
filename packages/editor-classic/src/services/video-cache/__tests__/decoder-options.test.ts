import { afterEach, expect, test } from "bun:test";
import { resolveVideoDecoderOptions } from "../decoder-options";

const original = Object.getOwnPropertyDescriptor(globalThis, "VideoDecoder");
afterEach(() => {
	if (original) Object.defineProperty(globalThis, "VideoDecoder", original);
	else Reflect.deleteProperty(globalThis, "VideoDecoder");
});

function setDecoder(
	isConfigSupported: (config: VideoDecoderConfig) => unknown,
) {
	Object.defineProperty(globalThis, "VideoDecoder", {
		configurable: true,
		value: { isConfigSupported },
	});
}

const config: VideoDecoderConfig = {
	codec: "avc1.64001f",
	codedWidth: 1920,
	codedHeight: 1080,
	description: Uint8Array.of(1, 2, 3),
};
const track = { getDecoderConfig: async () => config };

test("probes the original full config and forwards only the supported hint", async () => {
	const probes: VideoDecoderConfig[] = [];
	setDecoder(async (value) => {
		probes.push(value);
		return { supported: true, config: value };
	});
	expect(await resolveVideoDecoderOptions(track)).toEqual({
		hardwareAcceleration: "prefer-software",
	});
	expect(probes).toEqual([
		{ ...config, hardwareAcceleration: "prefer-software" },
	]);
	expect(config.hardwareAcceleration).toBeUndefined();
});

test("unsupported software decoding keeps the default sink options", async () => {
	setDecoder(async () => ({ supported: false }));
	expect(await resolveVideoDecoderOptions(track)).toBeUndefined();
});

test("capability and track probe failures keep the default path", async () => {
	setDecoder(async () => {
		throw new Error("probe unavailable");
	});
	expect(await resolveVideoDecoderOptions(track)).toBeUndefined();
	expect(
		await resolveVideoDecoderOptions({
			getDecoderConfig: async () => {
				throw new Error("config unavailable");
			},
		}),
	).toBeUndefined();
});

test("missing WebCodecs or missing track config preserves custom decoder support", async () => {
	Reflect.deleteProperty(globalThis, "VideoDecoder");
	expect(await resolveVideoDecoderOptions(track)).toBeUndefined();
	setDecoder(() => {
		throw new Error("must not probe null config");
	});
	expect(
		await resolveVideoDecoderOptions({ getDecoderConfig: async () => null }),
	).toBeUndefined();
});
