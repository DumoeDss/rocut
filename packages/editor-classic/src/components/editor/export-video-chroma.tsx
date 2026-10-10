"use client";

import { useId } from "react";
import type { ExportVideoChroma } from "../../export";

export function ExportVideoChromaControl({
	value,
	onChange,
}: {
	value: ExportVideoChroma;
	onChange: (value: ExportVideoChroma) => void;
}) {
	const id = useId();
	return (
		<div className="space-y-2 text-sm">
			<label htmlFor={id} className="flex flex-col gap-1">
				Color sampling
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
					<option value="420">4:2:0 — Standard compatibility</option>
					<option value="444">4:4:4 — High-fidelity color</option>
				</select>
			</label>
			<p id={`${id}-help`} className="text-xs text-muted-foreground">
				4:4:4 preserves fine color detail in WebM, but needs a supported encoder
				and may not play in all players. It does not change the quality preset.
				Unsupported encoders report an error; no automatic 4:2:0 fallback.
			</p>
		</div>
	);
}
