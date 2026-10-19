"use client";

import { useId } from "react";
import type { ExportVideoChroma } from "../../export";
import { useEditorMessages } from "../../editor/host/editor-host-context";

export function ExportVideoChromaControl({
	value,
	onChange,
}: {
	value: ExportVideoChroma;
	onChange: (value: ExportVideoChroma) => void;
}) {
	const id = useId();
	const messages = useEditorMessages();
	return (
		<div className="space-y-2 text-sm">
			<label htmlFor={id} className="flex flex-col gap-1">
				{messages.chroma}
				<select
					id={id}
					aria-describedby={`${id}-help`}
					value={value}
					onChange={(event) => {
						if (event.target.value === "420" || event.target.value === "444")
							onChange(event.target.value);
					}}
					className="rounded border bg-background p-2"
				>
					<option value="420">{messages.chroma420}</option>
					<option value="444">{messages.chroma444}</option>
				</select>
			</label>
			<p id={`${id}-help`} className="text-xs text-muted-foreground">
				{messages.chromaHelp}
			</p>
		</div>
	);
}
