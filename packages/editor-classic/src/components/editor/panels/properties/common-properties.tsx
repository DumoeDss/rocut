import { useState } from "react";
import type { EditorCore } from "../../../../core";
import { useEditor, useEditorInstance } from "../../../../editor/use-editor";
import {
	getElementParams,
	readElementParamValue,
} from "../../../../params/registry";
import { type NumberParamDefinition } from "../../../../params";
import { useEditorMessages } from "../../../../editor/host/editor-host-context";
import { buildCommonPropertyUpdates } from "./common-property-edit";

export function selectCommonPropertyElements({
	editor,
}: {
	editor: EditorCore;
}) {
	return editor.timeline
		.getElementsWithTracks({
			elements: editor.selection.getSelectedElements(),
		})
		.map(({ element }) => element);
}

export function selectCommonPropertyTracks({ editor }: { editor: EditorCore }) {
	return editor.timeline
		.getElementsWithTracks({
			elements: editor.selection.getSelectedElements(),
		})
		.map(({ track }) => track);
}

/** Batch edits use the same command boundary as single-element property edits. */
export function CommonProperties() {
	const messages = useEditorMessages();
	const labels: Record<string, string> = {
		opacity: messages.propertyOpacity,
		volume: messages.propertyVolume,
		"transform.positionX": messages.propertyPositionX,
		"transform.positionY": messages.propertyPositionY,
		"transform.scaleX": messages.propertyScaleX,
		"transform.scaleY": messages.propertyScaleY,
		"transform.rotate": messages.propertyRotation,
	};
	const editor = useEditorInstance();
	// Match wrappers are newly allocated on every lookup. Subscribe to their
	// stable members so useEditor's shallow snapshot cache can settle.
	const elements = useEditor((editor) =>
		selectCommonPropertyElements({ editor }),
	);
	const tracks = useEditor((editor) => selectCommonPropertyTracks({ editor }));
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const selected = elements.map((element, index) => ({
		element,
		track: tracks[index],
	}));
	const first = elements[0];
	if (!first) return null;
	const fields = getElementParams({ element: first }).filter(
		(param): param is NumberParamDefinition =>
			param.type === "number" &&
			[
				"opacity",
				"volume",
				"transform.positionX",
				"transform.positionY",
				"transform.scaleX",
				"transform.scaleY",
				"transform.rotate",
			].includes(param.key) &&
			elements.every((element) =>
				getElementParams({ element }).some(
					(candidate) => candidate.key === param.key,
				),
			),
	);
	return (
		<div
			className="w-full space-y-3 p-3"
			aria-label={messages.commonProperties}
		>
			{fields.length === 0 && (
				<p className="text-xs text-muted-foreground">
					{messages.noCommonProperties}
				</p>
			)}
			{fields.map((param) => {
				const animated = elements.some((element) =>
					Object.entries(element.animations ?? {}).some(
						([key, channel]) =>
							channel !== undefined &&
							(key === param.key || key === `params.${param.key}`),
					),
				);
				const locked = selected.some(({ track }) => track.locked);
				const values = elements.map((element) =>
					readElementParamValue({ element, param }),
				);
				const mixed = values.some((value) => value !== values[0]);
				return (
					<label key={param.key} className="flex flex-col gap-1 text-xs">
						<span>
							{labels[param.key]}
							{animated
								? messages.animatedProperty
								: locked
									? messages.lockedProperty
									: ""}
						</span>
						<input
							type="number"
							aria-label={`${messages.commonPrefix}${labels[param.key]}`}
							disabled={animated || locked}
							min={param.min}
							max={param.max}
							step={param.step}
							placeholder={mixed ? messages.mixedValues : undefined}
							value={
								drafts[param.key] ??
								(mixed ? "" : String(values[0] ?? param.default))
							}
							onChange={(event) =>
								setDrafts({ ...drafts, [param.key]: event.target.value })
							}
							onBlur={(event) => {
								const updates = buildCommonPropertyUpdates({
									selected,
									param,
									raw: event.target.value,
								});
								if (updates.length) editor.timeline.updateElements({ updates });
								setDrafts((current) => {
									const next = { ...current };
									delete next[param.key];
									return next;
								});
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter") event.currentTarget.blur();
							}}
							className="rounded border bg-background px-2 py-1 disabled:opacity-50"
						/>
					</label>
				);
			})}
		</div>
	);
}
