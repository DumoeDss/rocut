import type { MvEmberSurfaceDraw } from "@opencut/editor-contracts";
import type { MvInkPlan } from "../../packages/editor-contracts/src/mv-ink";
export type InkMutation = (plan: MvInkPlan) => void;
function map({
	plan,
	mutate,
}: {
	plan: MvInkPlan;
	mutate: (command: MvEmberSurfaceDraw) => MvEmberSurfaceDraw;
}): void {
	Reflect.set(
		plan,
		"commands",
		plan.commands.map((command) =>
			command.kind === "surface" || command.kind === "appendSurface"
				? { ...command, commands: command.commands.map(mutate) }
				: command,
		),
	);
}
function omitBlits({
	plan,
	prefix,
}: {
	plan: MvInkPlan;
	prefix: string;
}): void {
	map({
		plan,
		mutate: (command) =>
			command.kind === "blit" && command.surface.startsWith(prefix)
				? { ...command, opacity: 0 }
				: command,
	});
}
export const inkMutations: Record<string, InkMutation> = {
	"no-back-tendrils": (plan) => omitBlits({ plan, prefix: "ik-back" }),
	"no-front-coil": (plan) => omitBlits({ plan, prefix: "ik-front" }),
	"no-pools": (plan) => omitBlits({ plan, prefix: "ik-pool-b" }),
	"no-fog": (plan) => omitBlits({ plan, prefix: "ik-fog" }),
	"no-rim": (plan) => omitBlits({ plan, prefix: "ik-rim" }),
	"no-density": (plan) =>
		map({
			plan,
			mutate: (c) =>
				c.kind === "blit" && c.composite === "destination-out"
					? { ...c, opacity: 0 }
					: c,
		}),
	"no-soft-bleed": (plan) =>
		map({
			plan,
			mutate: (c) =>
				c.kind === "blit" && /ik-(?:front|back)-(?:hb|qb)/.test(c.surface)
					? { ...c, opacity: 0 }
					: c,
		}),
	"no-gooey-contrast": (plan) =>
		map({
			plan,
			mutate: (c) =>
				c.kind === "blit" && c.raster?.contrast !== undefined
					? { ...c, raster: { ...c.raster, contrast: 1 } }
					: c,
		}),
	"no-shading": (plan) => {
		Reflect.set(
			plan,
			"commands",
			plan.commands.map((c) =>
				c.kind === "surface" && c.id === "ik-char-lit"
					? {
							...c,
							commands: c.commands.filter(
								(child) =>
									!(
										child.kind === "rect" &&
										child.paint.composite === "source-atop"
									),
							),
						}
					: c,
			),
		);
	},
	"wrong-contact-gradient-stop-order": (plan) =>
		map({
			plan,
			mutate: (c) => {
				if (c.kind !== "gradientRect" || c.paint.style.kind !== "radial")
					return c;
				const stops = c.paint.style.stops;
				const first = stops[0],
					last = stops[1];
				if (stops.length !== 2 || !first || !last)
					throw Error("Unexpected Ink contact gradient stops");
				return {
					...c,
					paint: {
						...c.paint,
						style: {
							...c.paint.style,
							stops: [
								{ ...first, color: last.color },
								{ ...last, color: first.color },
							],
						},
					},
				};
			},
		}),
};
/** Chromium applies radial-gradient geometry under the fill CTM, not the
 * creation CTM. Keep this distinct structural control, never claim its
 * native-call-order corruption must produce a pixel difference. */
export const inkPixelEquivalentMutations: Record<string, InkMutation> = {
	"wrong-contact-gradient-ctm": (plan) =>
		map({
			plan,
			mutate: (c) =>
				c.kind === "gradientRect"
					? {
							...c,
							styleTransform: c.transform,
							styleOperations: c.operations ?? [],
						}
					: c,
		}),
};
