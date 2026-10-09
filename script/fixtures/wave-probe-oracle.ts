import type { AssetResolver } from "@opencut/editor-ports";
import type { Effect } from "../../packages/editor-classic/src/effects/types";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import {
	assert,
	effect,
	spatialSource,
	type spatialScene,
} from "./spatial-probe-scene";

export type WaveCapture = (
	node: ReturnType<typeof spatialScene>,
	local: number,
) => Promise<Uint8ClampedArray>;

function rampScene(effects: Effect[]) {
	const tracks = {
		main: { id: "main", name: "Main", type: "video", elements: [] },
		audio: [],
		overlay: [
			{
				id: "ramp",
				name: "Ramp",
				type: "graphic",
				elements: [
					{
						id: "ramp-source",
						type: "graphic",
						name: "Coordinate ramp",
						definitionId: "programmatic",
						params: {},
						startTime: 12000,
						duration: 120000,
						trimStart: 40000,
						trimEnd: 0,
						effects,
						programmatic: {
							...spatialSource,
							code: `const c=canvas.getContext('2d');const d=c.createImageData(640,360);
for(let y=0;y<360;y++)for(let x=0;x<640;x++){const i=(y*640+x)*4;d.data[i]=x/3;d.data[i+1]=y/2;d.data[i+2]=80;d.data[i+3]=255;}c.putImageData(d,0,0);`,
						},
					},
				],
			},
		],
	} as unknown as SceneTracks;
	return buildScene({
		tracks,
		mediaAssets: [],
		canvasSize: { width: 640, height: 360 },
		duration: 132000,
		background: { type: "color", color: "#203040" },
		assetResolver: {} as AssetResolver,
		isPreview: false,
	});
}

export async function checkWaveCoordinateOracle(capture: WaveCapture) {
	const params = {
		eventCount: 1,
		event0Time: 0,
		event0X: 320.5 / 640,
		event0Y: 180.5 / 360,
		event0Amplitude: 1,
		speed: 0.25,
		wavelength: 0.2,
		width: 0.4,
		refraction: 0.08,
		decay: 0,
		lifetime: 2,
	};
	const baseline = await capture(rampScene([]), 60000);
	const actual = await capture(rampScene([effect("ripple", params)]), 60000);
	// At age 1/2 second the front is 45 px from the center. These samples
	// are 63 px away: exactly one quarter wavelength beyond the front.
	const displacement = 360 * 0.08 * (63 / 64) ** 2 * (3 / 4) ** 2;
	const checks = [
		{ x: 383, y: 180, dx: displacement, dy: 0 },
		{ x: 257, y: 180, dx: -displacement, dy: 0 },
		{ x: 320, y: 243, dx: 0, dy: displacement },
	];
	const observations = checks.map(({ x, y, dx, dy }) => {
		const sx = x + dx,
			sy = y + dy;
		const x0 = Math.floor(sx),
			y0 = Math.floor(sy);
		const fx = sx - x0,
			fy = sy - y0;
		const expected = [0, 1, 2, 3].map((channel) => {
			const value = (px: number, py: number) =>
				baseline[(py * 640 + px) * 4 + channel];
			return (
				(value(x0, y0) * (1 - fx) + value(x0 + 1, y0) * fx) * (1 - fy) +
				(value(x0, y0 + 1) * (1 - fx) + value(x0 + 1, y0 + 1) * fx) * fy
			);
		});
		const pixel = Array.from(
			actual.slice((y * 640 + x) * 4, (y * 640 + x) * 4 + 4),
		);
		assert(
			pixel.every(
				(value, channel) => Math.abs(value - expected[channel]) < 1.5,
			),
			`Wave coordinate oracle ${x},${y}: ${JSON.stringify({ pixel, expected })}`,
		);
		assert(
			pixel.some(
				(value, channel) =>
					Math.abs(value - baseline[(y * 640 + x) * 4 + channel]) > 3,
			),
			"Coordinate oracle did not refract the input",
		);
		return { x, y, pixel, expected };
	});
	for (let y = 0; y < 360; y++)
		for (let x = 0; x < 640; x++) {
			if ((x - 320) ** 2 + (y - 180) ** 2 < 189 ** 2) continue;
			const i = (y * 640 + x) * 4;
			assert(
				[0, 1, 2, 3].every((c) => actual[i + c] === baseline[i + c]),
				`Wave escaped finite packet support at ${x},${y}`,
			);
		}
	return { sampleTime: 60000, displacementPixels: displacement, observations };
}
