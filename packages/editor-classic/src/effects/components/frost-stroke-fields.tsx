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
			<h4 className="text-sm font-medium">融化笔触</h4>
			<p className="text-xs text-muted-foreground">
				时间以片段起点为基准，120000 tick 为 1 秒。笔触保留创作顺序；保持与恢复参数控制融化后的重新冻结。
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
						<span className="text-xs font-medium">笔触 {index + 1}</span>
						<Button
							size="sm"
							variant="ghost"
							disabled={Boolean(issue)}
							aria-label={`移除融化笔触 ${index + 1}`}
							data-testid={`effect-frost-remove-${index}`}
							onClick={() =>
								update(removeFrostStroke({ params, definitions, index }))
							}
						>
							移除笔触
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
				aria-label="添加融化笔触"
				data-testid="effect-frost-add"
				onClick={() => update(appendFrostStroke({ params, definitions }))}
			>
				添加笔触
			</Button>
			{(issue || count > 0) && (
				<Button
					size="sm"
					variant="ghost"
					aria-label="清空所有融化笔触"
					data-testid="effect-frost-clear"
					onClick={() => update(clearFrostStrokes({ params }))}
				>
					清空所有笔触
				</Button>
			)}
		</div>
	);
}
