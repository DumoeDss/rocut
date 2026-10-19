"use client";

import { useState } from "react";
import type { ParamValues } from "../../params";
import type { ElementAnimations } from "../../animation/types";
import type { Effect } from "../types";
import type { EffectElement, VisualElement } from "../../timeline";
import { useEditorInstance } from "../../editor/use-editor";
import { useElementPreview } from "../../timeline/hooks/use-element-preview";
import { SectionTitle } from "../../components/section";
import { EffectSection } from "./effect-section";
import { Button } from "../../components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { MagicWand05Icon } from "@hugeicons/core-free-icons";
import { cn } from "../../utils/ui";
import { useAssetsPanelStore } from "../../editor/use-session-store";

export function StandaloneEffectTab({
	element,
	trackId,
}: {
	element: EffectElement;
	trackId: string;
}) {
	const { renderElement, previewUpdates, commit } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});

	const effect: Effect = {
		id: element.id,
		type: element.effectType,
		params: element.params,
		enabled: true,
	};

	return (
		<div className="flex flex-col h-full">
			<div className="border-b px-3.5 h-11 shrink-0 flex items-center">
				<SectionTitle>效果</SectionTitle>
			</div>
			<EffectSection
				effect={effect}
				renderParams={(renderElement as EffectElement).params}
				element={renderElement as EffectElement}
				trackId={trackId}
				previewParams={({ params, animations }) =>
					previewUpdates({ params, ...(animations ? { animations } : {}) })
				}
				onCommit={commit}
			/>
		</div>
	);
}

export function ClipEffectsTab({
	element,
	trackId,
}: {
	element: VisualElement;
	trackId: string;
}) {
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dropIndex, setDropIndex] = useState<number | null>(null);
	const editor = useEditorInstance();
	const { renderElement, previewUpdates, commit } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});

	const effects: Effect[] = element.effects ?? [];

	const getRenderParams = ({ effectId }: { effectId: string }): ParamValues => {
		return (
			(renderElement as VisualElement).effects?.find((ef) => ef.id === effectId)
				?.params ??
			effects.find((ef) => ef.id === effectId)?.params ??
			{}
		);
	};

	const buildPreviewParams =
		(effectId: string) =>
		({
			params,
			animations,
		}: {
			params: ParamValues;
			animations?: ElementAnimations;
		}) => {
			const updatedEffects = (
				(renderElement as VisualElement).effects ?? []
			).map((existing) =>
				existing.id !== effectId ? existing : { ...existing, params },
			);
			previewUpdates({
				effects: updatedEffects,
				...(animations ? { animations } : {}),
			});
		};

	const handleDragStart = ({ index }: { index: number }) => setDragIndex(index);

	const handleDragOver = ({
		event,
		index,
	}: {
		event: React.DragEvent;
		index: number;
	}) => {
		event.preventDefault();
		if (index !== dropIndex) setDropIndex(index);
	};

	const handleDrop = ({ toIndex }: { toIndex: number }) => {
		if (dragIndex !== null && dragIndex !== toIndex) {
			editor.timeline.reorderClipEffects({
				trackId,
				elementId: element.id,
				fromIndex: dragIndex,
				toIndex,
			});
		}
		setDragIndex(null);
		setDropIndex(null);
	};

	const handleDragEnd = () => {
		setDragIndex(null);
		setDropIndex(null);
	};

	return (
		<div className="flex flex-col h-full">
			<div className="border-b px-3.5 h-11 shrink-0 flex items-center">
				<SectionTitle>效果</SectionTitle>
			</div>
			{effects.length === 0 ? (
				<EmptyView />
			) : (
				<ul className="flex flex-col">
					{effects.map((effect, index) => {
						const resolvedDragIndex = dragIndex ?? -1;
						const isDragging = dragIndex === index;
						const isDropTarget =
							dropIndex === index && dragIndex !== null && dragIndex !== index;
						const showTopDropIndicator =
							isDropTarget && index < resolvedDragIndex;
						const showBottomDropIndicator =
							isDropTarget && index > resolvedDragIndex;

						return (
							<li
								key={effect.id}
								draggable
								onDragStart={() => handleDragStart({ index })}
								onDragOver={(event) => handleDragOver({ event, index })}
								onDrop={() => handleDrop({ toIndex: index })}
								onDragEnd={handleDragEnd}
								className={cn(
									"group list-none",
									isDragging && "opacity-40",
									showTopDropIndicator && "border-t-2 border-primary",
									showBottomDropIndicator && "border-b-2 border-primary",
								)}
							>
								<EffectSection
									effect={effect}
									renderParams={getRenderParams({ effectId: effect.id })}
									element={renderElement as VisualElement}
									trackId={trackId}
									previewParams={buildPreviewParams(effect.id)}
									onCommit={commit}
									onToggle={() =>
										editor.timeline.toggleClipEffect({
											trackId,
											elementId: element.id,
											effectId: effect.id,
										})
									}
									onRemove={() =>
										editor.timeline.removeClipEffect({
											trackId,
											elementId: element.id,
											effectId: effect.id,
										})
									}
								/>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

function EmptyView() {
	const setActiveTab = useAssetsPanelStore((s) => s.setActiveTab);

	return (
		<div className="flex flex-col h-full items-center justify-center gap-4 text-center">
			<HugeiconsIcon
				icon={MagicWand05Icon}
				className="size-10 text-muted-foreground"
				strokeWidth={1}
			/>
			<div className="flex flex-col gap-2">
				<h3 className="font-medium text-foreground">尚无效果</h3>
				<p className="text-muted-foreground text-sm text-balance max-w-44">
					从素材面板为此图层添加效果。
				</p>
			</div>
			<Button
				variant="default"
				size="sm"
				onClick={() => setActiveTab("effects")}
			>
				打开效果
			</Button>
		</div>
	);
}
