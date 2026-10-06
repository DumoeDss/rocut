import type { PreviewResourceIssue } from "../resource-diagnostics";

export function PreviewResourceNotice({
	issues,
}: {
	readonly issues: readonly PreviewResourceIssue[];
}) {
	if (issues.length === 0) return null;
	return (
		<div
			role="status"
			aria-live="polite"
			data-testid="preview-resource-notice"
			className="text-foreground border-caution mx-2 mt-2 max-h-32 shrink-0 overflow-y-auto border-l-2 pl-2 pr-1 text-xs leading-5 break-words"
		>
			<p className="font-medium">{issues[0].diagnostic.message}</p>
			<details>
				<summary className="focus-visible:ring-ring cursor-pointer rounded-sm outline-none focus-visible:ring-2">
					Resource details and next steps ({issues.length})
				</summary>
				<p>
					Preview may use fallback glyphs. Export requires valid resources.
					Select the motion-text clip to change its font or text; restore
					unavailable font files before retrying export.
				</p>
				<ul className="list-disc space-y-1 pl-4">
					{issues.map(({ sequenceId, diagnostic }, index) => (
						<li key={`${sequenceId}:${index}`} className="break-all">
							{diagnostic.message}
							{diagnostic.codePoints && diagnostic.codePoints.length > 0 && (
								<p>
									Missing characters:{" "}
									{diagnostic.codePoints
										.map(
											(point) =>
												`U+${point.toString(16).toUpperCase().padStart(4, "0")}`,
										)
										.join(", ")}
								</p>
							)}
							<span className="text-muted-foreground">
								Sequence: {sequenceId}
							</span>
						</li>
					))}
				</ul>
			</details>
		</div>
	);
}
