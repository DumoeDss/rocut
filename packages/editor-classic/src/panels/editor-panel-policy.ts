import { PANEL_CONFIG } from "./layout";

export function getEditorPanelPolicy(width: number) {
	const available =
		Number.isFinite(width) && width > 0 ? Math.max(1, width - 32) : 1000;
	const compact = available < 960;
	const side = Math.min(35, (250 / available) * 100);
	return {
		compact,
		sidebarMin: Math.max(15, Math.min(32, (220 / available) * 100)),
		previewMin: compact ? 25 : 30,
		defaultLayout: compact
			? [side, 100 - 2 * side, side]
			: [
					PANEL_CONFIG.panels.tools,
					PANEL_CONFIG.panels.preview,
					PANEL_CONFIG.panels.properties,
				],
	};
}
