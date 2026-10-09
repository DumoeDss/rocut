import { expect, test } from "bun:test";
import { registerDefaultEffects } from "../index";
import { resolveEffectPassGroups } from "../../services/renderer/resolve-visual-state";
import { mediaTime } from "../../wasm/media-time";

registerDefaultEffects();
const channel = ({ start, end }: { start: number; end: number }) => ({
	keys: [0, 120000].map((ticks, i) => ({
		id: `k${i}`,
		time: mediaTime({ ticks }),
		value: i === 0 ? start : end,
		segmentToNext: "linear" as const,
		tangentMode: "auto" as const,
	})),
});

test("explicit lens trajectory is evaluated from stored keyframes on every seek", () => {
	const resolveAt = (localTime: number) =>
		resolveEffectPassGroups({
			effects: [
				{
					id: "lens-a",
					type: "lens",
					enabled: true,
					params: { centerX: 0.5, centerY: 0.5, radius: 0.25, zoom: 2 },
				},
			],
			animations: {
				"effects.lens-a.params.centerX": channel({ start: 0.1, end: 0.9 }),
				"effects.lens-a.params.centerY": channel({ start: 0.8, end: 0.2 }),
				"effects.lens-a.params.radius": channel({ start: 0.2, end: 0.4 }),
				"effects.lens-a.params.zoom": channel({ start: 1, end: 3 }),
			},
			localTime,
			frameRate: { numerator: 24000, denominator: 1001 },
			width: 640,
			height: 360,
		})[0][0];
	for (const [time, x, y, radius, zoom] of [
		[60000, 0.5, 0.5, 0.3, 2],
		[120000, 0.9, 0.2, 0.4, 3],
		[0, 0.1, 0.8, 0.2, 1],
		[30000, 0.3, 0.65, 0.25, 1.5],
		[60000, 0.5, 0.5, 0.3, 2],
	]) {
		const pass = resolveAt(time);
		expect(pass.shader).toBe("lens");
		for (const [key, expected] of Object.entries({
			centerX: x,
			centerY: y,
			radius,
			zoom,
		}))
			expect(pass.uniforms[key]).toBeCloseTo(expected);
	}
});

test("local ASCII and dither use the same trajectory channels without changing effect order", () => {
	const groups = resolveEffectPassGroups({
		effects: ["ascii", "retro-dither"].map((type) => ({
			id: type,
			type,
			enabled: true,
			params: { local: 1, centerX: 0.5 },
		})),
		animations: {
			"effects.ascii.params.centerX": channel({ start: 0, end: 1 }),
			"effects.retro-dither.params.centerX": channel({ start: 1, end: 0 }),
		},
		localTime: 30000,
		frameRate: { numerator: 30, denominator: 1 },
		width: 640,
		height: 360,
	});
	expect(groups.map((g) => g[0].shader)).toEqual(["ascii", "retro-dither"]);
	expect(groups[0][0].uniforms).toMatchObject({ local: 1, centerX: 0.25 });
	expect(groups[1][0].uniforms).toMatchObject({ local: 1, centerX: 0.75 });
});

test("magnify HUD and impulse channels are clip-local and seekable", () => {
	const at = (localTime: number) =>
		resolveEffectPassGroups({
			effects: [
				{
					id: "scope",
					type: "magnify",
					enabled: true,
					params: { zoom: 2, pulse: 0, hud: 0.8, lineWidth: 1.5 },
				},
			],
			animations: {
				"effects.scope.params.pulse": channel({ start: 0, end: 1 }),
				"effects.scope.params.hud": channel({ start: 0.2, end: 1 }),
				"effects.scope.params.lineWidth": channel({ start: 1, end: 3 }),
			},
			localTime,
			frameRate: { numerator: 30000, denominator: 1001 },
			width: 640,
			height: 360,
		})[0][0];
	for (const [time, pulse, hud, lineWidth] of [
		[60000, 0.5, 0.6, 2],
		[120000, 1, 1, 3],
		[0, 0, 0.2, 1],
		[60000, 0.5, 0.6, 2],
	]) {
		const pass = at(time);
		expect(pass.shader).toBe("magnify");
		for (const [key, value] of Object.entries({ pulse, hud, lineWidth }))
			expect(pass.uniforms[key]).toBeCloseTo(value);
	}
});
