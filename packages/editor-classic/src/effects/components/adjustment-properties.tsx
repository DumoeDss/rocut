"use client";

import { useRef, useState } from "react";
import { PanelView } from "../../components/editor/panels/assets/views/base-panel";
import { PropertyParamField } from "../../components/editor/panels/properties/components/property-param-field";
import { Button } from "../../components/ui/button";
import { useEditorInstance } from "../../editor/use-editor";
import type { EffectElement } from "../../timeline";
import { useElementPreview } from "../../timeline/hooks/use-element-preview";
import { normalizeColorAdjustment, type ColorAdjustment } from "../../wasm";
import { colorAdjustmentDefinition } from "../definitions/color-adjustment";

const neutral: ColorAdjustment = {
	exposure: 0,
	contrast: 0,
	saturation: 0,
	temperature: 0,
	tint: 0,
};

export function AdjustmentProperties({
	element,
	trackId,
}: {
	element: EffectElement;
	trackId: string;
}) {
	const editor = useEditorInstance();
	const { renderElement, previewUpdates, commit } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});
	const current = renderElement.adjustment ?? neutral;
	const values: Record<string, number> = { ...current };
	const draft = useRef(current);
	const busy = useRef(false);
	const [isSaving, setSaving] = useState(false);
	const [message, setMessage] = useState("");
	const preview = (params: ColorAdjustment) => {
		if (busy.current) return;
		draft.current = normalizeColorAdjustment(params);
		previewUpdates({ adjustment: draft.current });
	};
	const save = async () => {
		if (busy.current) return;
		const saved: Record<string, number> = {
			...(element.adjustment ?? neutral),
		};
		if (
			Object.entries(draft.current).every(
				([key, value]) => saved[key] === value,
			)
		) {
			editor.timeline.discardPreview();
			return;
		}
		busy.current = true;
		setSaving(true);
		setMessage("");
		try {
			if (!(await commit())) {
				editor.timeline.discardPreview();
				setMessage(
					"Adjustment was not saved. Previous colors restored; try again.",
				);
			}
		} finally {
			busy.current = false;
			setSaving(false);
		}
	};
	const reset = () => {
		if (busy.current || Object.values(current).every((value) => value === 0)) return;
		preview(neutral);
		void save();
	};
	return (
		<PanelView
			title="Color adjustment"
			contentClassName="px-3 pb-4"
			footer={
				message ? (
					<p role="alert" className="text-sm">
						{message}
					</p>
				) : undefined
			}
			actions={
				<Button
					size="sm"
					variant="ghost"
					// Keep focus inside the embedded editor so Ctrl+Z works after saving.
					aria-disabled={
						isSaving || Object.values(current).every((value) => value === 0)
					}
					onClick={reset}
				>
					Reset colors
				</Button>
			}
		>
			<p className="text-muted-foreground mb-4 text-xs">
				Adjusts all picture tracks below this layer, within its timeline range.
			</p>
			<fieldset aria-busy={isSaving} className="flex min-w-0 flex-col gap-4">
				{colorAdjustmentDefinition.params.map((param) => (
					<PropertyParamField
						key={param.key}
						param={param}
						value={values[param.key] ?? param.default}
						onPreview={(value) => {
							if (typeof value === "number")
								preview({ ...current, [param.key]: value });
						}}
						onCommit={() => void save()}
					/>
				))}
			</fieldset>
		</PanelView>
	);
}
