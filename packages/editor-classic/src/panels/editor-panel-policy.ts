import { PANEL_CONFIG, WIDE_PANEL_WIDTHS } from "./layout";

export function getEditorPanelPolicy(width: number) {
	const available =
		Number.isFinite(width) && width > 0 ? Math.max(1, width - 32) : 1000;
	const compact = available < 960;
	const side = Math.min(35, (250 / available) * 100);
	const assets = (WIDE_PANEL_WIDTHS.assets / available) * 100;
	const properties = (WIDE_PANEL_WIDTHS.properties / available) * 100;
	const measured = Number.isFinite(width) && width > 0;
	return {
		focus: available < 608,
		compact,
		sidebarMin: compact
			? Math.max(15, Math.min(32, (220 / available) * 100))
			: (220 / available) * 100,
		previewMin: compact ? 25 : 30,
		defaultLayout: compact
			? [side, 100 - 2 * side, side]
			: measured
				? [assets, 100 - assets - properties, properties]
				: [
						PANEL_CONFIG.panels.tools,
						PANEL_CONFIG.panels.preview,
						PANEL_CONFIG.panels.properties,
					],
	};
}

export function getHorizontalPanelLayout({
	width,
	panels,
	hasCustomHorizontalLayout,
	compactLayout,
	assetsCollapsed,
	inspectorCollapsed,
}: {
	width: number;
	panels: { tools: number; preview: number; properties: number };
	hasCustomHorizontalLayout: boolean;
	compactLayout: number[] | null;
	assetsCollapsed: boolean;
	inspectorCollapsed: boolean;
}) {
	const policy = getEditorPanelPolicy(width);
	const layout = policy.compact
		? (compactLayout ?? policy.defaultLayout)
		: hasCustomHorizontalLayout
			? [panels.tools, panels.preview, panels.properties]
			: policy.defaultLayout;
	const assets = assetsCollapsed ? 0 : layout[0];
	const properties = inspectorCollapsed ? 0 : layout[2];
	return [assets, 100 - assets - properties, properties];
}
