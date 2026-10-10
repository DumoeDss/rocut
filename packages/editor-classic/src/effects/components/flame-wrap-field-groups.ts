import type { ParamDefinition } from "../../params";

export function flameWrapFieldGroups({
	definitions,
}: {
	definitions: readonly ParamDefinition[];
}) {
	return [
		{ label: "Boundary", keys: ["amount", "boundaryWidth", "flameHeight"] },
		{ label: "Optics", keys: ["flameOpacity", "sparkOpacity", "refraction"] },
		{ label: "Timing and seed", keys: ["speed", "wind", "seed"] },
	].map(({ label, keys }) => ({
		label,
		params: definitions.filter((param) => keys.includes(param.key)),
	}));
}
