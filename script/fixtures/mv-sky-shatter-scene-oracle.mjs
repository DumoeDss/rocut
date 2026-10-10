// Whole original SkyShatter main Canvas-call trace. Does not certify raster/pixel parity.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	assertionCount,
	clock,
	context,
	equivalent,
	project,
	record,
	registerSky,
} from "./mv-heart-rebirth-oracle-runtime.mjs";
const path = process.env.MV_HEART_ORACLE_ARTIFACT_PATH;
assert.ok(path);
const frames = JSON.parse(readFileSync(path, "utf8"));
assert.ok(frames.length > 0);
for (const frame of frames) {
	const t = frame.songTicks / 120000;
	const t0 = (frame.shotStartTicks ?? 0) / 120000;
	const t1 = (frame.shotEndTicks ?? 600000) / 120000;
	const args = { bg: "fixture-sky", char: "fixture-character", ...frame.args };
	const impact = args.impact ?? [1150, 300];
	const sky = context.window.skyBuildOracle(
		args.bg,
		args.seed ?? 3913,
		impact[0],
		impact[1],
		args.night ?? "#070b1c",
	);
	registerSky(sky);
	const expected = record((main) =>
		context.window.drawSkyShatterOracle(main, {
			args,
			t,
			tq: Math.floor(t * 12 + 1e-6) / 12,
			p: (t - t0) / (t1 - t0),
			shot: { t0, t1 },
			clock,
		}),
	);
	equivalent(project(frame.plan), expected, `sky/${frame.songTicks}`);
}
console.log(
	JSON.stringify({
		mode: "skyShatter",
		frames: frames.length,
		assertions: assertionCount(),
		tolerance: 1e-8,
		pixelParity: false,
	}),
);
