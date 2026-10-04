"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { TransitionRightIcon } from "@hugeicons/core-free-icons";
import { PanelView } from "../components/editor/panels/assets/views/base-panel";
import { Button } from "../components/ui/button";
import { useEditor } from "../editor/use-editor";
import { usePropertiesStore } from "../editor/use-session-store";
import { selectElementWithTrackTuple } from "../timeline/element-with-track-selector";
import { useElementSelection } from "../timeline/hooks/element/use-element-selection";

export function TransitionsView() {
	const { selectedElements } = useElementSelection();
	const [, element] = useEditor((editor) =>
		selectElementWithTrackTuple({
			editor,
			elements: selectedElements,
		}),
	);
	const { setActiveTab } = usePropertiesStore();
	const supported =
		selectedElements.length === 1 &&
		(element?.type === "video" || element?.type === "image");
	return (
		<PanelView title="Transitions" contentClassName="px-3 pb-4">
			<div className="flex min-w-0 flex-col gap-3">
				<h3 className="text-sm font-medium">Cross dissolve</h3>
				<p className="text-muted-foreground text-xs">
					Blend adjacent video or image clips without moving their timeline
					positions.
				</p>
				<Button
					variant="outline"
					className="h-auto min-h-8 whitespace-normal py-2"
					data-testid="transition-configure"
					disabled={!supported}
					onClick={() => {
						if (supported && element)
							setActiveTab({ elementType: element.type, tabId: "transition" });
					}}
				>
					<HugeiconsIcon icon={TransitionRightIcon} size={16} />
					Configure cross dissolve
				</Button>
				<p className="text-muted-foreground text-xs">
					{supported
						? "Choose the outgoing clip and duration in the properties panel. The selected clip is the incoming picture."
						: "Select one incoming video or image clip on the timeline first."}
				</p>
			</div>
		</PanelView>
	);
}
