import { afterAll, expect, test } from "bun:test";
import { getHorizontalPanelLayout } from "../../panels/editor-panel-policy";

const original = Object.getOwnPropertyDescriptor(globalThis, "window");
const entries = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
	configurable: true,
	value: {
		localStorage: {
			getItem: (key: string) => entries.get(key) ?? null,
			setItem: (key: string, value: string) => entries.set(key, value),
			removeItem: (key: string) => entries.delete(key),
		},
	},
});
const { createPanelStore } = await import("../panel-store");
afterAll(() => {
	if (original) Object.defineProperty(globalThis, "window", original);
	else Reflect.deleteProperty(globalThis, "window");
});

test("only deliberate horizontal updates opt out of content-sized defaults", () => {
	entries.clear();
	const store = createPanelStore();
	expect(store.getState().hasCustomHorizontalLayout).toBe(false);
	store.getState().setPanel({ panel: "timeline", size: 40 });
	expect(store.getState().hasCustomHorizontalLayout).toBe(false);
	store.getState().setPanels({ tools: 25, preview: 50, properties: 25 });
	expect(store.getState().hasCustomHorizontalLayout).toBe(true);
	expect(createPanelStore().getState().hasCustomHorizontalLayout).toBe(true);
	store.getState().resetPanels();
	expect(store.getState().hasCustomHorizontalLayout).toBe(false);
	expect(createPanelStore().getState().hasCustomHorizontalLayout).toBe(false);
	store.getState().setPanel({ panel: "properties", size: 28 });
	expect(store.getState().hasCustomHorizontalLayout).toBe(true);
});

test("legacy saved ratios including exact old defaults remain user preferences", async () => {
	entries.clear();
	const store = createPanelStore();
	const migrate = store.persist.getOptions().migrate;
	expect(
		await migrate?.({ panels: { tools: 25, preview: 50, properties: 25 } }, 2),
	).toMatchObject({
		hasCustomHorizontalLayout: true,
		panels: { tools: 25, preview: 50, properties: 25 },
	});
	expect(
		await migrate?.(
			{ toolsPanel: 18, previewPanel: 61, propertiesPanel: 21 },
			1,
		),
	).toMatchObject({
		hasCustomHorizontalLayout: true,
		panels: { tools: 18, preview: 61, properties: 21 },
	});
});

test("compact preferences reopen independently of wide proportions", () => {
	entries.clear();
	const store = createPanelStore();
	store.getState().setPanels({ tools: 22, preview: 56, properties: 22 });
	store.getState().setCompactLayout([33, 34, 33]);
	const reopened = createPanelStore().getState();
	expect(reopened.compactLayout).toEqual([33, 34, 33]);
	expect(reopened.panels).toMatchObject({
		tools: 22,
		preview: 56,
		properties: 22,
	});
	const stored = entries.get("panel-sizes");
	for (const width of [800, 1920, 727, 1280, 900]) {
		const layout = getHorizontalPanelLayout({
			...reopened,
			width,
			assetsCollapsed: false,
			inspectorCollapsed: false,
		});
		expect(layout).toEqual(width < 992 ? [33, 34, 33] : [22, 56, 22]);
	}
	expect(entries.get("panel-sizes")).toBe(stored);
});

test("compact resizing does not opt out of fresh wide defaults", () => {
	entries.clear();
	const store = createPanelStore();
	const sizes = [32, 35, 33];
	store.getState().setCompactLayout(sizes);
	sizes[0] = 40;
	const reopened = createPanelStore().getState();
	expect(reopened.compactLayout).toEqual([32, 35, 33]);
	expect(reopened.hasCustomHorizontalLayout).toBe(false);
	const wide = getHorizontalPanelLayout({
		...reopened,
		width: 1280,
		assetsCollapsed: false,
		inspectorCollapsed: false,
	});
	expect((wide[0] * (1280 - 32)) / 100).toBeCloseTo(300);
});

test("presets persist compact choices and reset clears both layout modes", () => {
	entries.clear();
	const store = createPanelStore();
	store.getState().setCompactLayout([20, 60, 20]);
	store.getState().setPanels({ tools: 20, preview: 60, properties: 20 });
	expect(createPanelStore().getState().compactLayout).toEqual([20, 60, 20]);
	store.getState().setCompactLayout([25, 50, 25]);
	expect(createPanelStore().getState().compactLayout).toEqual([25, 50, 25]);
	store.getState().resetPanels();
	const reopened = createPanelStore().getState();
	expect(reopened.compactLayout).toBeNull();
	expect(reopened.hasCustomHorizontalLayout).toBe(false);
	expect(reopened.panels).toMatchObject({
		tools: 25,
		preview: 50,
		properties: 25,
	});
});

test("v3 preferences preserve deliberate wide-layout intent when upgraded", () => {
	for (const hasCustomHorizontalLayout of [false, true]) {
		entries.clear();
		entries.set(
			"panel-sizes",
			JSON.stringify({
				version: 3,
				state: {
					panels: {
						tools: 24,
						preview: 52,
						properties: 24,
						mainContent: 68,
						timeline: 32,
					},
					hasCustomHorizontalLayout,
				},
			}),
		);
		const upgraded = createPanelStore().getState();
		expect(upgraded.hasCustomHorizontalLayout).toBe(hasCustomHorizontalLayout);
		expect(upgraded.panels).toMatchObject({
			tools: 24,
			preview: 52,
			properties: 24,
		});
		expect(upgraded.compactLayout).toBeNull();
	}
});

test("malformed compact preferences cannot become a panel layout", () => {
	entries.clear();
	const store = createPanelStore();
	store.getState().setCompactLayout([33, 34, 33]);
	for (const sizes of [
		[10, 20],
		[20, 20, 20],
		[0, 50, 50],
		[NaN, 30, 70],
		[-1, 31, 70],
	])
		store.getState().setCompactLayout(sizes);
	expect(store.getState().compactLayout).toEqual([33, 34, 33]);
	for (const value of ["bad", {}, [null, 50, 50], [20, 20, 20], [0, 50, 50]]) {
		entries.set(
			"panel-sizes",
			JSON.stringify({
				version: 4,
				state: { compactLayout: value },
			}),
		);
		expect(createPanelStore().getState().compactLayout).toBeNull();
	}
});
