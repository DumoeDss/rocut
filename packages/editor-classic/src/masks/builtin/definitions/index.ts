import {
	BASE_MASK_PARAM_DEFINITIONS,
	masksRegistry,
	type MaskDefinitionForRegistration,
	type MaskIconProps,
	type RegisteredMaskDefinition,
} from "../../registry";
import { cinematicBarsMaskDefinition } from "./cinematic-bars";
import { diamondMaskDefinition } from "./diamond";
import { ellipseMaskDefinition } from "./ellipse";
import { heartMaskDefinition } from "./heart";
import { rectangleMaskDefinition } from "./rectangle";
import { splitMaskDefinition } from "./split";
import { starMaskDefinition } from "./star";
import { textMaskDefinition } from "./text";
import { freeformMaskDefinition } from "../../freeform/definition";
import {
	MinusSignIcon,
	PanelRightDashedIcon,
	SquareIcon,
	CircleIcon,
	FavouriteIcon,
	DiamondIcon,
	StarsIcon,
	TextFontIcon,
	PenToolAddIcon,
} from "@hugeicons/core-free-icons";

const defaultMasks = [
	{
		definition: splitMaskDefinition,
		icon: { icon: PanelRightDashedIcon, strokeWidth: 1 },
	},
	{ definition: cinematicBarsMaskDefinition, icon: { icon: MinusSignIcon } },
	{ definition: rectangleMaskDefinition, icon: { icon: SquareIcon } },
	{ definition: ellipseMaskDefinition, icon: { icon: CircleIcon } },
	{ definition: heartMaskDefinition, icon: { icon: FavouriteIcon } },
	{ definition: diamondMaskDefinition, icon: { icon: DiamondIcon } },
	{ definition: starMaskDefinition, icon: { icon: StarsIcon } },
	{ definition: textMaskDefinition, icon: { icon: TextFontIcon } },
	{ definition: freeformMaskDefinition, icon: { icon: PenToolAddIcon } },
] satisfies ReadonlyArray<{
	definition: MaskDefinitionForRegistration;
	icon: MaskIconProps;
}>;

function isCanonicalDefaultMask({
	registered,
	definition,
	icon,
}: {
	registered: RegisteredMaskDefinition;
	definition: MaskDefinitionForRegistration;
	icon: MaskIconProps;
}): boolean {
	const params = [...definition.params, ...BASE_MASK_PARAM_DEFINITIONS];
	return (
		registered.type === definition.type &&
		registered.name === definition.name &&
		registered.features === definition.features &&
		registered.renderer === definition.renderer &&
		registered.interaction === definition.interaction &&
		registered.isActive === definition.isActive &&
		registered.buildDefault === definition.buildDefault &&
		registered.computeParamUpdate === definition.computeParamUpdate &&
		registered.icon.icon === icon.icon &&
		registered.icon.strokeWidth === icon.strokeWidth &&
		registered.params.length === params.length &&
		registered.params.every((param, index) => param === params[index])
	);
}

function registerDefaultMask({
	definition,
	icon,
}: {
	definition: MaskDefinitionForRegistration;
	icon: MaskIconProps;
}) {
	if (masksRegistry.has(definition.type)) {
		if (
			!isCanonicalDefaultMask({
				registered: masksRegistry.get(definition.type),
				definition,
				icon,
			})
		) {
			throw new Error(
				`Conflicting default mask definition at key "${definition.type}".`,
			);
		}
		return;
	}

	masksRegistry.registerMask({ definition, icon });
}

export function registerDefaultMasks(): void {
	for (const entry of defaultMasks) registerDefaultMask(entry);
}
