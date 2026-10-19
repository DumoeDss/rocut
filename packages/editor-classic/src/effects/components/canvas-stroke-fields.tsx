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
			<h4 className="text-sm font-medium">运动轨迹</h4>
			<p className="text-xs text-muted-foreground">
				时间以片段起点为基准，120000 tick 为 1 秒。开始时间必须早于结束时间，结束时间不得超出素材回放时长。轨迹保留创作顺序。
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
						轨迹 {index + 1}
					</summary>
					<Button
						size="sm"
						variant="ghost"
						disabled={Boolean(issue)}
						aria-label={`移除轨迹 ${index + 1}`}
						onClick={() =>
							update(removeCanvasStroke({ params, definitions, index }))
						}
					>
						移除轨迹
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
				aria-label="添加轨迹"
				data-testid="effect-canvas-add"
				onClick={() => update(appendCanvasStroke({ params, definitions }))}
			>
				添加轨迹 ({count}/{maximum})
			</Button>
			{(issue || count > 0) && (
				<Button
					size="sm"
					variant="ghost"
					aria-label="清空所有轨迹"
					data-testid="effect-canvas-clear"
					onClick={() => update(clearCanvasStrokes({ params }))}
				>
					清空所有轨迹
				</Button>
			)}
		</div>
	);
}
