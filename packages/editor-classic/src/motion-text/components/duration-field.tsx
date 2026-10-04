"use client";

import { Input } from "../../components/ui/input";

export function MotionTextDurationField({
	value,
	onChange,
	invalid,
}: {
	readonly value: string;
	readonly invalid?: boolean;
	readonly onChange: (value: string) => void;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<label htmlFor="motion-text-duration" className="text-xs font-medium">
				Duration (seconds)
			</label>
			<Input
				id="motion-text-duration"
				type="number"
				min="0"
				step="any"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				aria-invalid={invalid}
				aria-describedby={
					invalid
						? "motion-text-duration-help motion-text-message"
						: "motion-text-duration-help"
				}
				size="sm"
				className="tabular-nums"
			/>
			<p
				id="motion-text-duration-help"
				className="text-muted-foreground text-xs leading-5"
			>
				Set the full lyric range. Rounded to the project frame rate.
			</p>
		</div>
	);
}
