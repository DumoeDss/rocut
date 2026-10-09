import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { FPS, WIDTH, HEIGHT } from "./master-encoder-analysis.mjs";

/** Native policy example calls the same public Rust function as the WASM bridge. */
export function applyRustPlans({ cases, executable }) {
	return cases.map((testCase) => {
		if (!testCase.adapter) return testCase;
		const request = {
			codec: "vp9",
			format: "webm",
			quality: "very_high",
			width: WIDTH,
			height: HEIGHT,
			frameRate: { numerator: FPS, denominator: 1 },
			videoQuantizer: testCase.quantizer,
			...(testCase.profile === 1 ? { videoChroma: "444" } : {}),
		};
		const plan = JSON.parse(
			execFileSync(executable, [JSON.stringify(request)], {
				windowsHide: true,
				timeout: 30000,
				maxBuffer: 1024 * 1024,
			}).toString("utf8"),
		);
		assert.equal(plan.kind, "vp9Quantizer");
		assert.equal(plan.quantizer, testCase.quantizer);
		assert.ok(plan.nativeConfig && typeof plan.nativeConfig.codec === "string");
		assert.equal(plan.nativeConfig.width, WIDTH);
		assert.equal(plan.nativeConfig.height, HEIGHT);
		assert.equal(plan.nativeConfig.framerate, FPS);
		assert.equal(plan.nativeConfig.bitrateMode, "quantizer");
		assert.ok(
			Number.isSafeInteger(plan.keyFrameIntervalFrames) &&
				plan.keyFrameIntervalFrames > 0,
		);
		for (const [index, frame] of testCase.frames.entries())
			assert.equal(
				frame.options.keyFrame,
				index % plan.keyFrameIntervalFrames === 0,
			);
		return {
			...testCase,
			config: plan.nativeConfig,
			rustPolicy: { request, response: plan },
		};
	});
}
