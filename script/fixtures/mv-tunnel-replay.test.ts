import { expect, test } from "bun:test";
import { tunnelCanvasFontRole } from "./mv-tunnel-canvas-controls";
import { controlledTunnelPost } from "./mv-tunnel-native-replay";
import type { ReferencePostPlan } from "../../packages/editor-contracts/src";

test("native normalized aliases classify primary roles, never fallback roles", () => {
	const alias = `mv-tunnel-${"a".repeat(64)}-400`;
	const fallback = `mv-tunnel-${"b".repeat(64)}-400`;
	for (const prefix of ["", "normal ", "400 ", "normal 400 "]) {
		expect(
			tunnelCanvasFontRole({
				font: `${prefix}18px "${alias}", "${fallback}"`,
				fontRoles: { [alias]: "dot400", [fallback]: "noto400" },
			}),
		).toBe("dot400");
	}
	expect(
		tunnelCanvasFontRole({
			font: 'normal 800 100px "Shippori Mincho"',
			fontRoles: {},
		}),
	).toBe("mincho800");
	expect(
		tunnelCanvasFontRole({ font: '900 56px "Noto Sans JP"', fontRoles: {} }),
	).toBe("heavy900");
});
const plan: ReferencePostPlan = {
	profile: "tunnel-original-gl-v1",
	required: true,
	width: 1920,
	height: 1080,
	songTicks: 360000,
	allocationBytes: 1,
	lutAtlasRequired: false,
	targets: [],
	passes: [
		{
			shader: "comp",
			target: "comp",
			textures: { scene: "scene" },
			uniforms: { zoomBlur: 0.12, zoomCenter: [0.5, 0.5], boil: 1.2 },
		},
		{
			shader: "final",
			target: null,
			textures: { comp: "comp" },
			uniforms: { bloom: 0.35, vignette: 0.35 },
		},
	],
};
test("six post negatives mutate native uniforms only with receipts and preserve clock/pass policy", () => {
	const expected: Record<string, readonly [number, string, number | number[]]> =
		{
			"no-bloom": [1, "bloom", 0],
			"no-post-vignette": [1, "vignette", 0],
			"no-zoom-blur": [0, "zoomBlur", 0],
			"no-boil": [0, "boil", 0],
			"wrong-settle": [0, "zoomBlur", 0.058],
			"wrong-center": [0, "zoomCenter", [0.2, 0.2]],
		};
	for (const [name, [index, key, value]] of Object.entries(expected)) {
		const applied: Record<string, number> = {};
		const result = controlledTunnelPost({ plan, name, applied });
		expect(result.passes[index]!.uniforms[key]).toEqual(value);
		expect(applied[name]).toBe(1);
		expect(result.songTicks).toBe(plan.songTicks);
		expect(result.targets).toBe(plan.targets);
		expect(result.passes.map((p) => [p.shader, p.target, p.textures])).toEqual(
			plan.passes.map((p) => [p.shader, p.target, p.textures]),
		);
	}
	expect(plan.passes[0]!.uniforms.zoomBlur).toBe(0.12);
	expect(() =>
		controlledTunnelPost({ plan, name: "unknown", applied: {} }),
	).toThrow();
});
