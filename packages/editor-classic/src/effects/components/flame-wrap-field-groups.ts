import type { ParamDefinition } from "../../params";

export function flameWrapFieldGroups({
	definitions,
}: {
	definitions: readonly ParamDefinition[];
}) {
	return [
		{ label: "边界", keys: ["amount", "boundaryWidth", "flameHeight"] },
		{ label: "光学", keys: ["flameOpacity", "sparkOpacity", "refraction"] },
		{ label: "时间与种子", keys: ["speed", "wind", "seed"] },
	].map(({ label, keys }) => ({
		label,
		params: definitions.filter((param) => keys.includes(param.key)),
	}));
}
