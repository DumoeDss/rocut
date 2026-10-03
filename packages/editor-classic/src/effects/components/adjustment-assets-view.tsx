"use client";

import { useRef, useState } from "react";
import { InsertElementCommand } from "../../commands/timeline/element/insert-element";
import { UpdateElementsCommand } from "../../commands/timeline/element/update-elements";
import { PanelView } from "../../components/editor/panels/assets/views/base-panel";
import { Button } from "../../components/ui/button";
import { useEditor, useEditorInstance } from "../../editor/use-editor";
import { buildEffectElement } from "../../timeline/element-utils";
import { selectElementWithTrackTuple } from "../../timeline/element-with-track-selector";
import { colorAdjustmentCatalog, type ColorAdjustment } from "../../wasm";

export function AdjustmentAssetsView() {
	const editor = useEditorInstance();
	const [, selected] = useEditor((current) =>
		selectElementWithTrackTuple({
			editor: current,
			elements: current.selection.getSelectedElements(),
		}),
	);
	const busy = useRef(false);
	const [isBusy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const applyToSelected =
		selected?.type === "effect" && selected.effectType === "color-adjustment";
	const apply = async ({
		params,
		name,
	}: {
		params: ColorAdjustment;
		name: string;
	}) => {
		if (busy.current) return;
		busy.current = true;
		setBusy(true);
		setMessage("");
		try {
			const [track, element] = selectElementWithTrackTuple({
				editor,
				elements: editor.selection.getSelectedElements(),
			});
			if (
				track &&
				element?.type === "effect" &&
				element.effectType === "color-adjustment"
			) {
				const saved: Record<string, number> = { ...element.adjustment };
				if (
					Object.entries(params).every(([key, value]) => saved[key] === value)
				) {
					setMessage(name + " is already applied.");
					return;
				}
				await editor.command.execute({
					command: new UpdateElementsCommand({
						updates: [
							{
								trackId: track.id,
								elementId: element.id,
								patch: { adjustment: { ...params } },
							},
						],
					}),
				});
				setMessage(name + " applied.");
			} else {
				const command = new InsertElementCommand({
					element: {
						...buildEffectElement({
							effectType: "color-adjustment",
							startTime: element?.startTime ?? editor.playback.getCurrentTime(),
							duration: element?.duration,
						}),
						name: "Color adjustment",
						adjustment: { ...params },
					},
					placement: { mode: "auto", trackType: "effect" },
				});
				await editor.command.execute({ command });
				if (!command.getTrackId())
					throw new Error("The adjustment layer could not be added.");
				setMessage(name + " adjustment added above the picture tracks.");
			}
		} catch (error) {
			setMessage(
				error instanceof Error
					? error.message
					: "The adjustment could not be saved.",
			);
		} finally {
			busy.current = false;
			setBusy(false);
		}
	};
	return (
		<PanelView
			title="Adjustment"
			footer={
				<p className="text-muted-foreground text-xs" role="status">
					{message ||
						"Affects the picture tracks below it; audio is unchanged."}
				</p>
			}
		>
			<p className="text-muted-foreground px-1 pb-3 text-sm">
				{applyToSelected
					? "Apply a preset to the selected adjustment layer."
					: selected
						? "Add a color layer covering the selected clip’s time range."
						: "Add a color layer at the playhead, then trim it on the timeline."}
			</p>
			<div className="flex flex-col divide-y pb-4">
				{colorAdjustmentCatalog().presets.map((preset) => (
					<div
						key={preset.id}
						className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1 py-3"
					>
						<div className="min-w-0 flex-1">
							<h3 className="text-sm font-medium">{preset.name}</h3>
							<p className="text-muted-foreground text-xs">
								{preset.description}
							</p>
						</div>
						<Button
							size="sm"
							variant="outline"
							aria-disabled={isBusy || undefined}
							aria-busy={isBusy || undefined}
							className="aria-disabled:cursor-wait aria-disabled:opacity-50"
							aria-label={
								(applyToSelected ? "Apply " : "Add ") +
								preset.name +
								" adjustment"
							}
							onClick={() => void apply(preset)}
						>
							{applyToSelected ? "Apply" : "Add"}
						</Button>
					</div>
				))}
			</div>
		</PanelView>
	);
}
