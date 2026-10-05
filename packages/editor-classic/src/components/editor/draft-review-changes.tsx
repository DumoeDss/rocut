import { useState } from "react";
import type { DraftContentSnapshot } from "@opencut/editor-contracts/draft";
import { TICKS_PER_SECOND } from "../../wasm";
import { changedReviewFields, type ReviewField } from "./draft-review-diff";

function display(value: unknown): string {
	if (value === undefined) return "Not present";
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function FieldComparison({ field }: { field: ReviewField }) {
	const [expanded, setExpanded] = useState(false);
	const before = display(field.before);
	const after = display(field.after);
	const long = before.length + after.length > 700;
	const values = (
		<div className="grid min-w-0 gap-3 sm:grid-cols-2">
			{[
				{ label: "Before", value: before },
				{ label: "After", value: after },
			].map(({ label, value }) => (
				<div key={label} className="min-w-0">
					<div className="mb-1 text-xs text-muted-foreground">{label}</div>
					<pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded border bg-background p-2 font-sans text-sm">
						{value}
					</pre>
				</div>
			))}
		</div>
	);
	return (
		<section
			className="space-y-2 border-b pb-4 last:border-b-0"
			aria-label={field.path}
		>
			<h4 className="break-all text-sm font-medium">{field.path}</h4>
			{long ? (
				<details onToggle={(event) => setExpanded(event.currentTarget.open)}>
					<summary className="cursor-pointer text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
						Show complete values ({before.length + after.length} characters)
					</summary>
					{expanded && <div className="mt-2">{values}</div>}
				</details>
			) : (
				values
			)}
		</section>
	);
}

export function DraftChanges({
	before,
	after,
}: {
	before: DraftContentSnapshot;
	after: DraftContentSnapshot;
}) {
	const fields = changedReviewFields({ before, after });
	return (
		<div className="space-y-4" data-testid="draft-review-changes">
			<p className="text-xs text-muted-foreground">
				{fields.length} changed fields. Time values use media ticks (
				{TICKS_PER_SECOND.toLocaleString()} per second). Large values can be
				expanded in full.
			</p>
			{fields.map((field) => (
				<FieldComparison key={field.path} field={field} />
			))}
			{fields.length === 0 && (
				<p className="text-sm text-muted-foreground">No content differences.</p>
			)}
		</div>
	);
}
