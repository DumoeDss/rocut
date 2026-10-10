import { expect, test } from "bun:test";
import type { MvInkPlan } from "../../packages/editor-contracts/src/mv-ink";
import {
	inkMutations,
	inkPixelEquivalentMutations,
} from "./mv-ink-native-mutations";

function contactPlan(): MvInkPlan {
	return {
		commands: [
			{
				kind: "surface",
				id: "ik-scene",
				size: [1920, 1080],
				commands: [
					{
						kind: "gradientRect",
						transform: [1, 0, 0, 1, 0, 0],
						operations: [{ kind: "scale", factors: [1, 0.15] }],
						styleTransform: [1, 0, 0, 1, 0, 0],
						styleOperations: [],
						clip: null,
						rect: [600, 640, 720, 720],
						paint: {
							kind: "fill",
							composite: "source-over",
							opacity: 1,
							style: {
								kind: "radial",
								from: [960, 992, 0],
								to: [960, 992, 330],
								stops: [
									{ offset: 0, color: [40 / 255, 34 / 255, 40 / 255, 0.4] },
									{ offset: 1, color: [40 / 255, 34 / 255, 40 / 255, 0] },
								],
							},
						},
					},
				],
			},
		],
	};
}
function contact(plan: MvInkPlan) {
	const surface = plan.commands[0];
	if (surface?.kind !== "surface") throw Error("Missing contact surface");
	const command = surface.commands[0];
	if (command?.kind !== "gradientRect" || command.paint.style.kind !== "radial")
		throw Error("Missing radial contact command");
	return command;
}
test("Creation CTM corruption remains an independent structural pixel-equivalent control", () => {
	const plan = contactPlan(),
		before = structuredClone(contact(plan));
	const mutate = inkPixelEquivalentMutations["wrong-contact-gradient-ctm"];
	if (!mutate) throw Error("Missing creation CTM control");
	mutate(plan);
	const after = contact(plan);
	expect(after.styleOperations).toEqual(before.operations ?? []);
	expect(after.styleOperations).not.toEqual(before.styleOperations);
	expect(after.transform).toEqual(before.transform);
	expect(after.operations).toEqual(before.operations);
	expect(after.paint).toEqual(before.paint);
	expect(after.rect).toEqual(before.rect);
	expect(inkMutations["wrong-contact-gradient-ctm"]).toBeUndefined();
});
test("Sensitive stop-order corruption preserves original offsets and color collection", () => {
	const plan = contactPlan(),
		before = structuredClone(contact(plan));
	const mutate = inkMutations["wrong-contact-gradient-stop-order"];
	if (!mutate) throw Error("Missing stop-order control");
	mutate(plan);
	const after = contact(plan);
	if (
		before.paint.style.kind !== "radial" ||
		after.paint.style.kind !== "radial"
	)
		throw Error("Missing radial stops");
	expect(after.paint.style.stops.map((stop) => stop.offset)).toEqual(
		before.paint.style.stops.map((stop) => stop.offset),
	);
	expect(after.paint.style.stops.map((stop) => stop.color)).toEqual(
		before.paint.style.stops.map((stop) => stop.color).reverse(),
	);
	expect(after.operations).toEqual(before.operations);
	expect(after.styleOperations).toEqual(before.styleOperations);
	expect(Object.keys(inkMutations)).toHaveLength(10);
});
