import type { GraphicDefinition } from "../types";

/** Registry metadata/thumbnail only. Full frames are evaluated by ProgrammaticNode. */
export const programmaticGraphicDefinition: GraphicDefinition = {
	id: "programmatic",
	requiresSource: true,
	name: "Programmatic source",
	keywords: ["canvas", "webgl", "html", "programmatic"],
	params: [],
	render({ ctx, width, height }) {
		ctx.fillStyle = "#64748b";
		ctx.font = `${Math.round(height / 5)}px monospace`;
		ctx.textAlign = "center";
		ctx.fillText("</>", width / 2, height * 0.58);
	},
};
