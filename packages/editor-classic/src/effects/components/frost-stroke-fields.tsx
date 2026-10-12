import { FrostNumberField } from "./frost-number-field";
import { Button } from "../../components/ui/button";
import type { ParamDefinition, ParamValues } from "../../params";
import {
	appendFrostStroke,
	removeFrostStroke,
	clearFrostStrokes,
	frostStrokeState,
	FROST_STROKE_FIELDS,
} from "./frost-stroke-edit";

export function FrostStrokeFields({
	params,
	definitions,
	preview,
	commit,
}: {
	params: ParamValues;
	definitions: readonly ParamDefinition[];
	preview: (params: ParamValues) => void;
	commit: () => void;
}) {
	const { count, maximum, issue } = frostStrokeState({ params, definitions });
	const update = (next: ParamValues) => {
		preview(next);
		commit();
	};
	return (
		<div className="flex flex-col gap-4" data-testid="effect-frost-strokes">
			<h4 className="text-sm font-medium">Melt strokes</h4>
			<p className="text-xs text-muted-foreground">
				Times are clip-local ticks. 120000 ticks = 1 second. Strokes retain
				their authored order. Hold and recovery control refreezing after thaw.
			</p>
			{issue ? (
				<p role="alert" className="text-xs text-destructive">
					{issue}
				</p>
			) : null}
			{Array.from({ length: count }, (_, index) => (
				<div
					key={index}
					className="flex flex-col gap-3"
					data-testid={`effect-frost-stroke-${index}`}
				>
					<div className="flex items-center justify-between">
						<span className="text-xs font-medium">Stroke {index + 1}</span>
						<Button
							size="sm"
							variant="ghost"
							disabled={Boolean(issue)}
							aria-label={`Remove melt stroke ${index + 1}`}
							data-testid={`effect-frost-remove-${index}`}
							onClick={() =>
								update(removeFrostStroke({ params, definitions, index }))
							}
						>
							Remove stroke
						</Button>
					</div>
					{FROST_STROKE_FIELDS.map((field) => {
						const param = definitions.find(
							(item) => item.key === `stroke${index}${field}`,
						);
						return param ? (
							<div
								key={param.key}
								data-testid={`effect-frost-field-${param.key}`}
							>
								<FrostNumberField
									param={param}
									value={params[param.key]}
									onPreview={(value) =>
										preview({ ...params, [param.key]: value })
									}
									onCommit={commit}
								/>
							</div>
						) : null;
					})}
				</div>
			))}
			<Button
				size="sm"
				variant="secondary"
				disabled={Boolean(issue) || count >= maximum}
				aria-label="Add melt stroke"
				data-testid="effect-frost-add"
				onClick={() => update(appendFrostStroke({ params, definitions }))}
			>
				Add stroke
			</Button>
			{(issue || count > 0) && (
				<Button
					size="sm"
					variant="ghost"
					aria-label="Clear all melt strokes"
					data-testid="effect-frost-clear"
					onClick={() => update(clearFrostStrokes({ params }))}
				>
					Clear all strokes
				</Button>
			)}
		</div>
	);
}
