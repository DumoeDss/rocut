import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
	changePostCurves,
	postAmountDomain,
	postAutomationCatalog,
	postCurvesFit,
} from "./programmatic-recipe-post-automation-data";
import { postObject, type PostRecord } from "./programmatic-recipe-post-data";

export function ProgrammaticRecipePostAutomationFields({
	id,
	post,
	durationFrames,
	finishingEffects,
	automation,
	disabled,
	onChange,
}: {
	id: string;
	post: PostRecord;
	durationFrames: number;
	finishingEffects: PostRecord;
	automation: PostRecord;
	disabled: boolean;
	onChange: (post: PostRecord) => void;
}) {
	const rules = postAutomationCatalog(automation),
		effects = post.effects as PostRecord[],
		curves = (
			Object.hasOwn(post, "automation") ? post.automation : []
		) as unknown[];
	if (
		!rules ||
		!Array.isArray(effects) ||
		!postCurvesFit(
			curves,
			effects,
			durationFrames,
			finishingEffects,
			automation,
		)
	)
		return (
			<p className="text-muted-foreground text-xs">
				Amount curves are unavailable for this catalog or draft. Edit the JSON
				and use Apply to validate.
			</p>
		);
	const change = (next: unknown[]) => {
		const result = changePostCurves(
			post,
			next,
			durationFrames,
			finishingEffects,
			automation,
			disabled,
		);
		if (result) onChange(result);
		return !!result;
	};
	return (
		<div className="flex min-w-0 flex-col gap-2">
			<p className="text-muted-foreground text-xs">
				Amount curves use outer source frames, including {durationFrames}.
				Effect indices start at 0. Apply validates the complete draft.
			</p>
			{effects.map((effect, effectIndex) => {
				const domain = postAmountDomain(effect, finishingEffects, automation);
				if (!domain) return null;
				const curveIndex = curves.findIndex(
						(value) => postObject(value)?.effect === effectIndex,
					),
					curve = postObject(curves[curveIndex]),
					keys = curve?.keyframes as PostRecord[] | undefined;
				const label = `effect ${effectIndex} ${String(effect.kind)}`,
					prefix = `${id}-effect-${effectIndex}`;
				const editKey = (keyIndex: number, key: PostRecord) => {
					if (!curve || !keys) return;
					change(
						curves.map((entry, index) =>
							index === curveIndex
								? {
										...curve,
										keyframes: keys.map((old, index) =>
											index === keyIndex ? key : old,
										),
									}
								: entry,
						),
					);
				};
				let newFrame = "",
					newValue = "",
					newEasing = "";
				let frameInput: HTMLInputElement | null = null,
					valueInput: HTMLInputElement | null = null,
					easingInput: HTMLSelectElement | null = null;
				const newFields: ReactNode = (
					<div className="grid min-w-0 grid-cols-3 gap-2">
						<div>
							<label htmlFor={`${prefix}-new-frame`} className="text-xs">
								Frame
							</label>
							<Input
								id={`${prefix}-new-frame`}
								ref={(element) => {
									frameInput = element;
								}}
								aria-label={`New ${label} keyframe frame`}
								type="number"
								min={0}
								max={durationFrames}
								step={1}
								disabled={disabled}
								onChange={(event) => {
									newFrame = event.target.value;
								}}
							/>
						</div>
						<div>
							<label htmlFor={`${prefix}-new-value`} className="text-xs">
								Value
							</label>
							<Input
								id={`${prefix}-new-value`}
								ref={(element) => {
									valueInput = element;
								}}
								aria-label={`New ${label} keyframe value`}
								type="number"
								min={domain.min}
								max={domain.max}
								step="any"
								disabled={disabled}
								onChange={(event) => {
									newValue = event.target.value;
								}}
							/>
						</div>
						<div>
							<label htmlFor={`${prefix}-new-easing`} className="text-xs">
								Easing
							</label>
							<select
								id={`${prefix}-new-easing`}
								ref={(element) => {
									easingInput = element;
								}}
								aria-label={`New ${label} keyframe easing`}
								className="bg-input w-full rounded border p-1 text-xs"
								defaultValue=""
								disabled={disabled}
								onChange={(event) => {
									newEasing = event.target.value;
								}}
							>
								<option value="">Choose explicitly</option>
								{rules.easings.map((easing) => (
									<option key={easing} value={easing}>
										{easing}
									</option>
								))}
							</select>
						</div>
					</div>
				);
				return (
					<fieldset
						key={effectIndex}
						disabled={disabled}
						className="flex min-w-0 flex-col gap-2 rounded border p-2"
					>
						<legend className="px-1 text-xs">Amount curve / {label}</legend>
						{keys?.map((key, keyIndex) => (
							<div key={keyIndex} className="flex min-w-0 flex-col gap-1">
								<div className="grid min-w-0 grid-cols-3 gap-2">
									<div>
										<label
											htmlFor={`${prefix}-key-${keyIndex}-frame`}
											className="text-xs"
										>
											Frame
										</label>
										<Input
											id={`${prefix}-key-${keyIndex}-frame`}
											aria-label={`${label} keyframe ${keyIndex} frame`}
											type="number"
											min={0}
											max={durationFrames}
											step={1}
											value={Number(key.frame)}
											disabled={disabled}
											onChange={(event) => {
												if (event.target.value.trim())
													editKey(keyIndex, {
														...key,
														frame: event.target.valueAsNumber,
													});
											}}
										/>
									</div>
									<div>
										<label
											htmlFor={`${prefix}-key-${keyIndex}-value`}
											className="text-xs"
										>
											Value
										</label>
										<Input
											id={`${prefix}-key-${keyIndex}-value`}
											aria-label={`${label} keyframe ${keyIndex} value`}
											type="number"
											min={domain.min}
											max={domain.max}
											step="any"
											value={Number(key.value)}
											disabled={disabled}
											onChange={(event) => {
												if (event.target.value.trim())
													editKey(keyIndex, {
														...key,
														value: event.target.valueAsNumber,
													});
											}}
										/>
									</div>
									<div>
										<label
											htmlFor={`${prefix}-key-${keyIndex}-easing`}
											className="text-xs"
										>
											Easing
										</label>
										<select
											id={`${prefix}-key-${keyIndex}-easing`}
											aria-label={`${label} keyframe ${keyIndex} easing`}
											className="bg-input w-full rounded border p-1 text-xs"
											value={String(key.easing)}
											disabled={disabled}
											onChange={(event) =>
												editKey(keyIndex, {
													...key,
													easing: event.target.value,
												})
											}
										>
											{rules.easings.map((easing) => (
												<option key={easing} value={easing}>
													{easing}
												</option>
											))}
										</select>
									</div>
								</div>
								<Button
									type="button"
									size="sm"
									variant="ghost"
									aria-label={`Remove ${label} keyframe ${keyIndex}`}
									disabled={disabled || keys.length === 1}
									onClick={() => {
										if (curve && keys.length > 1)
											change(
												curves.map((entry, index) =>
													index === curveIndex
														? {
																...curve,
																keyframes: keys.filter(
																	(_, index) => index !== keyIndex,
																),
															}
														: entry,
												),
											);
									}}
								>
									Remove keyframe
								</Button>
							</div>
						))}
						{newFields}
						<Button
							type="button"
							size="sm"
							variant="outline"
							aria-label={`${curve ? "Add keyframe to" : "Add amount curve for"} ${label}`}
							disabled={
								disabled ||
								(keys
									? keys.length >= rules.maxKeyframes
									: curves.length >= rules.maxCurves)
							}
							onClick={() => {
								newFrame = frameInput?.value ?? newFrame;
								newValue = valueInput?.value ?? newValue;
								newEasing = easingInput?.value ?? newEasing;
								if (
									disabled ||
									!newFrame.trim() ||
									!newValue.trim() ||
									!newEasing
								)
									return;
								const key = {
									frame: Number(newFrame),
									value: Number(newValue),
									easing: newEasing,
								};
								change(
									curve && keys
										? curves.map((entry, index) =>
												index === curveIndex
													? { ...curve, keyframes: [...keys, key] }
													: entry,
											)
										: [...curves, { effect: effectIndex, keyframes: [key] }],
								);
							}}
						>
							{curve ? "Add keyframe after last" : "Add amount curve"}
						</Button>
						{curve && (
							<Button
								type="button"
								size="sm"
								variant="ghost"
								aria-label={`Remove amount curve for ${label}`}
								disabled={disabled}
								onClick={() =>
									change(curves.filter((_, index) => index !== curveIndex))
								}
							>
								Remove amount curve
							</Button>
						)}
					</fieldset>
				);
			})}
		</div>
	);
}
