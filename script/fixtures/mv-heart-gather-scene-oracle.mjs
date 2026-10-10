// Full original drawGather main Canvas-call trace, both glass and firefly modes. Not pixels.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	assertionCount,
	clock,
	context,
	equivalent,
	project,
	record,
} from "./mv-heart-rebirth-oracle-runtime.mjs";
const artifact = process.env.MV_HEART_ORACLE_ARTIFACT_PATH;
assert.ok(artifact);
const frames = JSON.parse(readFileSync(artifact, "utf8"));
assert.ok(frames.length > 0);
for (const frame of frames) {
	const t = frame.songTicks / 120000;
	const t0 = (frame.shotStartTicks ?? 0) / 120000;
	const t1 = (frame.shotEndTicks ?? 600000) / 120000;
	const expected = record((main) =>
		context.window.drawGatherOracle(main, {
			args: { heart: "heart", char: "fixture-character", ...frame.args },
			t,
			tq: Math.floor(t * 12 + 1e-6) / 12,
			p: (t - t0) / (t1 - t0),
			shot: { t0, t1 },
			clock,
		}),
	);
	equivalent(
		project(frame.plan),
		expected,
		`gather/${frame.songTicks}/${frame.args?.firefly ?? false}`,
	);
}
console.log(
	JSON.stringify({
		mode: "gather",
		frames: frames.length,
		assertions: assertionCount(),
		tolerance: 1e-8,
		pixelParity: false,
	}),
);
