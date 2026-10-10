import { Button } from "../../components/ui/button";
import type { ParamDefinition, ParamValues } from "../../params";
import { CanvasNumberField } from "./canvas-number-field";
import {
	appendCanvasStroke,
	removeCanvasStroke,
	clearCanvasStrokes,
	canvasStrokeState,
	CANVAS_STROKE_FIELDS,
} from "./canvas-stroke-edit";

export function CanvasStrokeFields({
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
	const { count, maximum, issue } = canvasStrokeState({ params, definitions });
	const update = (next: ParamValues) => {
		preview(next);
		commit();
	};
	return (
		<div
			className="flex flex-col gap-4"
			data-testid="effect-canvas-trajectories"
		>
			<h4 className="text-sm font-medium">Trajectories</h4>
			<p className="text-xs text-muted-foreground">
				Times are clip-local ticks. 120000 ticks = 1 second. Start must precede
				end; end must fit the material replay duration. Trajectories retain
				their authored order.
			</p>
			{issue && (
				<p role="alert" className="text-xs text-destructive">
					{issue}
				</p>
			)}
			{Array.from({ length: count }, (_, index) => (
				<details
					key={index}
					open={count === 1}
					className="flex flex-col gap-3"
					data-testid={`effect-canvas-stroke-${index}`}
				>
					<summary className="text-xs font-medium">
						Trajectory {index + 1}
					</summary>
					<Button
						size="sm"
						variant="ghost"
						disabled={Boolean(issue)}
						aria-label={`Remove trajectory ${index + 1}`}
						onClick={() =>
							update(removeCanvasStroke({ params, definitions, index }))
						}
					>
						Remove trajectory
					</Button>
					{CANVAS_STROKE_FIELDS.map((field) => {
						const param = definitions.find(
							(item) => item.key === `stroke${index}${field}`,
						);
						return param ? (
							<CanvasNumberField
								key={param.key}
								param={param}
								value={params[param.key]}
								onPreview={(value) =>
									preview({ ...params, [param.key]: value })
								}
								onCommit={commit}
							/>
						) : null;
					})}
				</details>
			))}
			<Button
				size="sm"
				variant="secondary"
				disabled={Boolean(issue) || count >= maximum}
				aria-label="Add trajectory"
				data-testid="effect-canvas-add"
				onClick={() => update(appendCanvasStroke({ params, definitions }))}
			>
				Add trajectory ({count}/{maximum})
			</Button>
			{(issue || count > 0) && (
				<Button
					size="sm"
					variant="ghost"
					aria-label="Clear all trajectories"
					data-testid="effect-canvas-clear"
					onClick={() => update(clearCanvasStrokes({ params }))}
				>
					Clear all trajectories
				</Button>
			)}
		</div>
	);
}
