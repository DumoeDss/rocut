import { describe, expect, test } from "bun:test";
import {
	getEditorPanelPolicy,
	getHorizontalPanelLayout,
} from "../editor-panel-policy";

describe("embedded editor panel sizing", () => {
	test("hosts below 640px use focused views instead of unusably thin columns", () => {
		for (const width of [320, 454, 560, 639])
			expect(getEditorPanelPolicy(width).focus).toBe(true);
		for (const width of [640, 727, 1280, 0, -1, NaN, Infinity])
			expect(getEditorPanelPolicy(width).focus).toBe(false);
	});
	test("a 727px host gives both sidebars space without hiding the preview", () => {
		const policy = getEditorPanelPolicy(727);
		expect(policy.compact).toBe(true);
		expect(policy.defaultLayout).toEqual([35, 30, 35]);
		expect((policy.defaultLayout[0] / 100) * (727 - 32)).toBeGreaterThan(240);
		expect(policy.sidebarMin).toBeGreaterThan(30);
	});
	test("wide fresh layouts give content-sized sidebars and the remaining space to preview", () => {
		for (const width of [992, 1280, 1920, 3840]) {
			const policy = getEditorPanelPolicy(width);
			expect(policy.compact).toBe(false);
			expect((policy.defaultLayout[0] * (width - 32)) / 100).toBeCloseTo(300);
			expect((policy.defaultLayout[2] * (width - 32)) / 100).toBeCloseTo(280);
			expect((policy.defaultLayout[1] * (width - 32)) / 100).toBeCloseTo(
				width - 32 - 580,
			);
		}
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
	test("saved ratios, presets and explicit collapse survive wide resize and compact round trips", () => {
		const panels = { tools: 25, preview: 50, properties: 25 };
		const base = {
			panels,
			hasCustomHorizontalLayout: true,
			compactLayout: null,
			assetsCollapsed: false,
			inspectorCollapsed: false,
		};
		for (const width of [1280, 1920, 3840])
			expect(getHorizontalPanelLayout({ ...base, width })).toEqual([
				25, 50, 25,
			]);
		expect(
			getHorizontalPanelLayout({
				...base,
				width: 1920,
				panels: { tools: 20, preview: 60, properties: 20 },
			}),
		).toEqual([20, 60, 20]);
		expect(
			getHorizontalPanelLayout({
				...base,
				width: 727,
				compactLayout: [34, 32, 34],
			}),
		).toEqual([34, 32, 34]);
		expect(
			getHorizontalPanelLayout({ ...base, width: 1920, assetsCollapsed: true }),
		).toEqual([0, 75, 25]);
		expect(
			getHorizontalPanelLayout({
				...base,
				width: 1920,
				inspectorCollapsed: true,
			}),
		).toEqual([25, 75, 0]);
		expect(panels).toEqual({ tools: 25, preview: 50, properties: 25 });
	});
	test("fresh collapsed layouts retain the content width of the visible sidebar", () => {
		const layout = getHorizontalPanelLayout({
			width: 1920,
			panels: { tools: 25, preview: 50, properties: 25 },
			hasCustomHorizontalLayout: false,
			compactLayout: null,
			assetsCollapsed: true,
			inspectorCollapsed: false,
		});
		expect(layout[0]).toBe(0);
		expect((layout[2] * (1920 - 32)) / 100).toBeCloseTo(280);
	});
});
