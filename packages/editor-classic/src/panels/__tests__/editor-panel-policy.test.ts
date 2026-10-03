import { describe, expect, test } from "bun:test";
import { getEditorPanelPolicy } from "../editor-panel-policy";

describe("embedded editor panel sizing", () => {
	test("a 727px host gives both sidebars space without hiding the preview", () => {
		const policy = getEditorPanelPolicy(727);
		expect(policy.compact).toBe(true);
		expect(policy.defaultLayout).toEqual([35, 30, 35]);
		expect((policy.defaultLayout[0] / 100) * (727 - 32)).toBeGreaterThan(240);
		expect(policy.sidebarMin).toBeGreaterThan(30);
	});
	test("wide hosts retain the classic default proportions", () => {
		const policy = getEditorPanelPolicy(1280);
		expect(policy.compact).toBe(false);
		expect(policy.defaultLayout).toEqual([25, 50, 25]);
	});
	test("constraints remain satisfiable across host widths", () => {
		for (const width of [320, 480, 640, 727, 900, 991, 992, 1200, 1920, 3840]) {
			const p = getEditorPanelPolicy(width);
			expect(p.defaultLayout.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
			expect(p.sidebarMin * 2 + p.previewMin).toBeLessThanOrEqual(100);
			expect(p.defaultLayout[0]).toBeGreaterThanOrEqual(p.sidebarMin);
			expect(p.defaultLayout[1]).toBeGreaterThanOrEqual(p.previewMin);
			expect(p.defaultLayout[2]).toBeGreaterThanOrEqual(p.sidebarMin);
			expect(p.defaultLayout[0]).toBeLessThanOrEqual(40);
		}
	});
	test("unmeasured or invalid containers use a stable initial layout", () => {
		for (const width of [0, -1, NaN, Infinity])
			expect(getEditorPanelPolicy(width).defaultLayout).toEqual([25, 50, 25]);
	});
});
