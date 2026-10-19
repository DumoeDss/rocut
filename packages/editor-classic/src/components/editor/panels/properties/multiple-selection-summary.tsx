import type { ElementType } from "../../../../timeline/types";
import { useEditorMessages } from "../../../../editor/host/editor-host-context";

const TYPE_ORDER: readonly ElementType[] = [
	"video",
	"image",
	"audio",
	"text",
	"motion-text",
	"graphic",
	"sticker",
	"effect",
];

export function MultipleSelectionSummary({
	count,
	elementTypes,
}: {
	count: number;
	elementTypes: readonly ElementType[];
}) {
	const messages = useEditorMessages();
	const labels: Readonly<Record<ElementType, string>> = {
		video: messages.video,
		image: messages.image,
		audio: messages.audio,
		text: messages.text,
		"motion-text": messages.motionText,
		graphic: messages.graphic,
		sticker: messages.sticker,
		effect: messages.effect,
	};
	const counts = new Map<ElementType, number>();
	for (const type of elementTypes)
		counts.set(type, (counts.get(type) ?? 0) + 1);
	const summary = TYPE_ORDER.filter((type) => counts.has(type))
		.map((type) => `${labels[type]} ${counts.get(type)}`)
		.join(" · ");

	return (
		<div className="bg-background flex shrink-0 flex-col items-center justify-center overflow-hidden py-4">
			<p className="text-muted-foreground text-sm">{messages.selectedClips}: {count}</p>
			{summary && (
				<p
					data-testid="multi-selection-types"
					aria-label={messages.selectedClipTypes}
					className="px-4 pt-2 text-xs text-muted-foreground text-center"
				>
					{summary}
				</p>
			)}
			<p className="px-4 pt-2 text-xs text-muted-foreground text-center">
				{messages.commonPropertiesHelp}
			</p>
		</div>
	);
}
