import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { highChromaUiContract as contract } from "./high-chroma-ui-contract.mjs";
import { assertHighChromaUiMedia } from "./high-chroma-ui-decode.mjs";
import { highChromaUiInputs } from "./high-chroma-ui-inputs.mjs";
import { editorImage, editorSource } from "./droplets-editor-scene";

function metadata() {
	return {
		streams: [
			{
				codec_type: "video",
				codec_name: "vp9",
				profile: "Profile 1",
				pix_fmt: "yuv444p",
				width: 640,
				height: 360,
				nb_read_frames: "6",
			},
		],
		frames: Array.from({ length: 6 }, (_, frame) => ({
			media_type: "video",
			width: 640,
			height: 360,
			pix_fmt: "yuv444p",
			best_effort_timestamp_time: (frame / 30).toFixed(3),
		})),
	};
}

describe("high-chroma real UI acceptance contract", () => {
	test("six-frame transport contract is independent of historical optical acceptance", () => {
		expect(contract.request).toEqual({
			format: "webm",
			quality: "medium",
			videoChroma: "444",
			includeAudio: false,
		});
		expect(Number(contract.durationTicks)).toBe(
			(contract.frames * 120000) / contract.fps,
		);
		const image = editorImage();
		expect(image.readUInt32BE(16)).toBe(contract.width);
		expect(image.readUInt32BE(20)).toBe(contract.height);
		const source = editorSource({
			id: "droplets.png",
			kind: "image",
			mimeType: "image/png",
			attachmentKey: "programmatic/droplets.png",
			byteLength: image.length,
			sha256: "0".repeat(64),
		});
		expect(source.width).toBe(contract.width);
		expect(source.height).toBe(contract.height);
		expect(source.frameRate).toEqual({
			numerator: contract.fps,
			denominator: 1,
		});
	});

	test("independent inspector accepts millisecond WebM timestamps without rewriting pixels", () => {
		const inspected = assertHighChromaUiMedia(metadata());
		expect(inspected.frames).toBe(6);
		expect(inspected.profile).toBe("Profile 1");
		expect(inspected.pixelFormat).toBe("yuv444p");
		expect(inspected.timestamps).toEqual([0, 0.033, 0.067, 0.1, 0.133, 0.167]);
	});

	test("wrong codec/profile/chroma/shape/count cannot be a UI444 pass", () => {
		for (const patch of [
			{ codec_name: "h264" },
			{ profile: "Profile 0" },
			{ pix_fmt: "yuv420p" },
			{ width: 192 },
			{ height: 128 },
			{ nb_read_frames: "5" },
		]) {
			const invalid = metadata();
			Object.assign(invalid.streams[0], patch);
			expect(() => assertHighChromaUiMedia(invalid)).toThrow();
		}
		const extraStream = metadata();
		extraStream.streams.push({
			...extraStream.streams[0],
			codec_type: "audio",
		});
		expect(() => assertHighChromaUiMedia(extraStream)).toThrow();
		const missingFrame = metadata();
		missingFrame.frames.pop();
		expect(() => assertHighChromaUiMedia(missingFrame)).toThrow();
	});

	test("repeated, shifted, missing, malformed and differently sampled frame timestamps fail", () => {
		for (const time of ["0", "0.100", "NaN", "undefined"]) {
			const invalid = metadata();
			invalid.frames[5].best_effort_timestamp_time = time;
			expect(() => assertHighChromaUiMedia(invalid)).toThrow();
		}
		const wrongFrame = metadata();
		wrongFrame.frames[2].pix_fmt = "yuv420p";
		expect(() => assertHighChromaUiMedia(wrongFrame)).toThrow();
	});

	test("frozen UI launcher closure is unique and does not intercept encoder or renderer methods", async () => {
		expect(new Set(highChromaUiInputs).size).toBe(highChromaUiInputs.length);
		const owned = highChromaUiInputs.filter((path) =>
			path.includes("high-chroma-ui"),
		);
		expect(owned.length).toBe(7);
		for (const path of owned) {
			const source = await readFile(path, "utf8");
			expect(source).not.toMatch(
				/(?:VideoEncoder|CanvasSource|SceneExporter)\s*=/,
			);
			expect(source).not.toMatch(/\.prototype\s*\[/);
			expect(source).not.toContain("evaluateOnNewDocument");
			expect(source).not.toContain("addInitScript");
		}
	});
});
