import { PropertyParamField } from "../../components/editor/panels/properties/components/property-param-field";
import { Button } from "../../components/ui/button";
import type { ParamDefinition, ParamValues } from "../../params";
import { appendBubblePoint, removeBubblePoint } from "./bubble-trajectory-edit";

export function BubbleTrajectoryFields({
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
	const count = Number(params.pointCount);
	const countDefinition = definitions.find(
		(param) => param.key === "pointCount",
	);
	const maximum =
		countDefinition?.type === "number" ? (countDefinition.max ?? count) : count;
	const update = (next: ParamValues) => {
		preview(next);
		commit();
	};
	return (
		<div className="flex flex-col gap-4">
			<h4 className="text-sm font-medium">Trajectory</h4>
			<p className="text-xs text-muted-foreground">
				Point times are relative to the activity start, in ticks.
			</p>
			{Array.from({ length: count }, (_, index) => (
				<div key={index} className="flex flex-col gap-3">
					<div className="flex items-center justify-between">
						<span className="text-xs font-medium">Point {index + 1}</span>
						<Button
							size="sm"
							variant="ghost"
							disabled={count <= 1 || index === 0}
							title={
								index === 0
									? "The first point anchors the activity start."
									: undefined
							}
							onClick={() => update(removeBubblePoint({ params, index }))}
						>
							Remove point
						</Button>
					</div>
					{["Time", "X", "Y"].map((axis) => {
						const param = definitions.find(
							(item) => item.key === `point${index}${axis}`,
						);
						return param ? (
							<PropertyParamField
								key={param.key}
								param={param}
								value={params[param.key] ?? param.default}
								onPreview={(value) =>
									preview({ ...params, [param.key]: value })
								}
								onCommit={commit}
							/>
						) : null;
					})}
				</div>
			))}
			<Button
				size="sm"
				variant="secondary"
				disabled={count >= maximum}
				onClick={() => update(appendBubblePoint({ params, definitions }))}
			>
				Add point
			</Button>
		</div>
	);
}
