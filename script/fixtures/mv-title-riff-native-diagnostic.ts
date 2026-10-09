import type {
	MvEmberPlan,
	MvEmberSurfaceDraw,
} from "../../packages/editor-contracts/src/mv-ember-plan";
import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { captureTitleRiff } from "./mv-title-riff-native-capture";
import { difference } from "./mv-afterimage-capture";

/** TEST ONLY: isolate raster transport differences without changing the oracle,
 * public positive gate, admitted budgets or source frame. */
export async function diagnoseTitleRiffRaster(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
	index: number,
	expected: Uint8ClampedArray,
) {
	const observations: Record<string, unknown> = {};
	for (const mode of [
		"unchanged",
		"strokeRect",
		"globalAlpha",
		"both",
	] as const) {
		const counts = { strokeRect: 0, globalAlpha: 0 };
		const pixels = await captureTitleRiff(source, resources, index, {
			mutate: (plan: MvEmberPlan) => {
				const modify = (command: MvEmberSurfaceDraw): MvEmberSurfaceDraw => {
					if (
						(mode === "strokeRect" || mode === "both") &&
						command.kind === "path" &&
						command.paints.length === 1 &&
						command.paints[0]?.kind === "stroke"
					) {
						const [a, b, c, d, end] = command.path;
						if (
							command.path.length === 5 &&
							a?.kind === "moveTo" &&
							b?.kind === "lineTo" &&
							c?.kind === "lineTo" &&
							d?.kind === "lineTo" &&
							end?.kind === "close" &&
							a.point[1] === b.point[1] &&
							b.point[0] === c.point[0] &&
							c.point[1] === d.point[1] &&
							d.point[0] === a.point[0]
						) {
							counts.strokeRect++;
							return {
								kind: "rect",
								transform: command.transform,
								operations: command.operations,
								clip: command.clip,
								rect: [
									a.point[0],
									a.point[1],
									b.point[0] - a.point[0],
									c.point[1] - a.point[1],
								],
								paint: command.paints[0],
							};
						}
					}
					if (
						(mode === "globalAlpha" || mode === "both") &&
						command.kind === "rect" &&
						!command.clip &&
						!command.operations?.length &&
						command.rect.every((v, i) => v === [0, 0, 1920, 1080][i]) &&
						command.paint.style.kind === "solid"
					) {
						const { color } = command.paint.style;
						if (color[3] !== 1) {
							counts.globalAlpha++;
							return {
								...command,
								paint: {
									...command.paint,
									opacity: command.paint.opacity * color[3],
									style: {
										kind: "solid",
										color: [color[0], color[1], color[2], 1],
									},
								},
							};
						}
					}
					return command;
				};
				Reflect.set(
					plan,
					"commands",
					plan.commands.map((command) =>
						command.kind === "surface" || command.kind === "appendSurface"
							? { ...command, commands: command.commands.map(modify) }
							: command.kind === "releaseSurface"
								? command
								: modify(command),
					),
				);
			},
		});
		observations[mode] = { ...difference(pixels, expected), counts };
	}
	return observations;
}
