import type { ParamValues } from "../../params";
import type { ElementAnimations } from "../../animation/types";
import type { Effect } from "../types";
import type { EffectElement, VisualElement } from "../../timeline";
import { effectsRegistry } from "..";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
	SectionFields,
} from "../../components/section";
import { Button } from "../../components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Delete02Icon,
	ViewIcon,
	ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "../../utils/ui";
import { EffectFields } from "./effect-fields";

export function EffectSection({
	effect,
	renderParams,
	element,
	trackId,
	previewParams,
	onCommit,
	onToggle,
	onRemove,
}: {
	effect: Effect;
	renderParams: ParamValues;
	element: EffectElement | VisualElement;
	trackId: string;
	previewParams: (updates: {
		params: ParamValues;
		animations?: ElementAnimations;
	}) => void;
	onCommit: () => Promise<boolean>;
	onToggle?: () => void;
	onRemove?: () => void;
}) {
	const definition = effectsRegistry.get(effect.type);

	return (
		<Section
			sectionKey={onToggle ? `clip-effect:${effect.id}` : undefined}
			showTopBorder={false}
		>
			<SectionHeader
				className={cn(onToggle && "cursor-move")}
				trailing={
					onToggle && (
						<div className="flex items-center gap-1">
							<Button
								variant={effect.enabled ? "secondary" : "ghost"}
								size="icon"
								aria-label={`Toggle ${definition.name}`}
								onClick={onToggle}
							>
								<HugeiconsIcon
									icon={effect.enabled ? ViewIcon : ViewOffSlashIcon}
								/>
							</Button>
							<Button
								variant="ghost"
								size="icon"
								aria-label={`Remove ${definition.name}`}
								onClick={onRemove}
							>
								<HugeiconsIcon icon={Delete02Icon} />
							</Button>
						</div>
					)
				}
			>
				<SectionTitle
					className={cn(onToggle && !effect.enabled && "text-muted-foreground")}
				>
					{definition.name}
				</SectionTitle>
			</SectionHeader>
			<SectionContent
				className={cn("p-0", onToggle && !effect.enabled && "opacity-50")}
			>
				<SectionFields>
					<EffectFields
						effect={effect}
						element={element}
						trackId={trackId}
						params={renderParams}
						previewParams={previewParams}
						commit={onCommit}
					/>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}
