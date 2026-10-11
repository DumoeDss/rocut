import { useState } from "react";
import { Input } from "../../components/ui/input";
import { ProgrammaticSvgShapeFields } from "./programmatic-svg-shape-fields";
import { ProgrammaticModelTextureFields } from "./programmatic-model-texture-fields";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import {
	particleDraft,
	particleFieldsDisabled,
} from "./programmatic-particle-data";
import {
	changeModelSceneText,
	editModelSceneDraft,
	modelSceneFields,
	modelSceneFieldKey,
	modelSceneTexts,
	modelSceneResourceFields,
	selectModelSceneResource,
	type ModelSceneTexts,
} from "./programmatic-model-scene-data";
type Props = {
	id: string;
	state: BuildDraftSnapshot;
	canCompile: boolean;
	onEdit: (patch: { inputProps: string }) => void;
};
export function ProgrammaticModelSceneFields(props: Props) {
	if (
		!modelSceneFields({ state: props.state }).length &&
		!modelSceneResourceFields(props.state).length
	)
		return null;
	const initial = modelSceneTexts({ state: props.state });
	if (!initial)
		return (
			<p role="alert" className="text-destructive text-xs">
				Fix complete Input props JSON first. Your original text is retained.
			</p>
		);
	return (
		<>
			<ResourceFields {...props} />
			<ProgrammaticModelTextureFields {...props} />
			<ProgrammaticSvgShapeFields {...props} />
			{Object.keys(initial).length > 0 && (
				<SceneFields
					key={props.state.inputProps}
					{...props}
					initial={initial}
				/>
			)}
		</>
	);
}
function ResourceFields({ id, state, canCompile, onEdit }: Props) {
	const fields = modelSceneResourceFields(state),
		props = particleDraft(state.inputProps);
	if (!fields.length || !props) return null;
	const disabled =
		particleFieldsDisabled({ state, canCompile }) ||
		props.assetKind !== state.baseline.build?.inputProps?.assetKind;
	return (
		<fieldset
			disabled={disabled}
			className="border-input flex min-w-0 flex-col gap-2 rounded-md border p-2 text-xs"
		>
			<legend className="px-1">Archived scene resources</legend>
			<p className="text-muted-foreground">
				Only declared archived resources. No import, automatic selection, or
				asset-kind conversion. Use the existing Recompile and apply action.
			</p>
			{fields.map((field) => {
				const current = props[field.key],
					known = field.choices.some((choice) => choice.id === current),
					value = typeof current === "string" ? current : "",
					fieldId = `${id}-scene-resource-${field.key}`;
				return (
					<div key={field.key} className="flex min-w-0 flex-col gap-1">
						<label htmlFor={fieldId}>{field.label}</label>
						<select
							id={fieldId}
							value={value}
							disabled={disabled}
							className="bg-background text-foreground border-input focus-visible:ring-ring h-8 min-w-0 rounded-md border px-2 text-xs focus-visible:ring-2"
							onChange={(event) => {
								if (disabled) return;
								const inputProps = selectModelSceneResource({
									state,
									canCompile,
									key: field.key,
									next: event.target.value,
								});
								if (inputProps !== undefined && inputProps !== state.inputProps)
									onEdit({ inputProps });
							}}
						>
							<option value="" disabled={!field.clearable}>
								{field.clearable
									? "None (disabled)"
									: "No model selected (retained)"}
							</option>
							{typeof current === "string" && current !== "" && !known && (
								<option value={current} disabled>
									Unavailable resource (retained): {current}
								</option>
							)}
							{field.choices.map((choice) => (
								<option key={choice.id} value={choice.id}>
									{choice.id} ({choice.mimeType})
								</option>
							))}
						</select>
						{current !== undefined && !known && (
							<p role="status" className="text-muted-foreground">
								Current {field.key} is unavailable or invalid and retained:{" "}
								{JSON.stringify(current)}
							</p>
						)}
					</div>
				);
			})}
		</fieldset>
	);
}
function SceneFields({
	id,
	state,
	canCompile,
	onEdit,
	initial,
}: Props & { initial: ModelSceneTexts }) {
	const [texts, setTexts] = useState(initial),
		disabled = particleFieldsDisabled({ state, canCompile });
	const fields = modelSceneFields({ state }).filter((f) =>
		Object.hasOwn(texts, modelSceneFieldKey(f)),
	);
	const validation = editModelSceneDraft({ state, texts });
	const change = (key: string, next: string) => {
		const result = changeModelSceneText({
			state,
			canCompile,
			texts,
			key,
			next,
		});
		if (!result) return;
		setTexts(result.texts);
		if (
			result.inputProps !== undefined &&
			result.inputProps !== state.inputProps
		)
			onEdit({ inputProps: result.inputProps });
	};
	return (
		<fieldset
			disabled={disabled}
			className="border-input flex min-w-0 flex-col gap-2 rounded-md border p-2 text-xs"
		>
			<legend className="px-1">Three scene fields</legend>
			<p className="text-muted-foreground">
				Edit declared scene values. Vectors use [x,y,z] JSON; no missing values
				or material shaders are generated. Apply through the existing Recompile
				and apply action.
			</p>
			{(["Camera", "Model transform", "Scene/environment"] as const).map(
				(group) => {
					const members = fields.filter((f) => f.group === group);
					return !members.length ? null : (
						<div key={group} className="flex min-w-0 flex-col gap-2">
							<h4 className="font-medium">{group}</h4>
							{members.map((field) => {
								const key = modelSceneFieldKey(field),
									fieldId = `${id}-scene-${key.replaceAll(".", "-")}`;
								return (
									<div key={key} className="flex min-w-0 flex-col gap-1">
										<label htmlFor={fieldId}>{field.label}</label>
										<Input
											id={fieldId}
											size="xs"
											value={texts[key]}
											disabled={disabled}
											spellCheck={false}
											aria-invalid={!!validation.error}
											aria-describedby={`${id}-scene-status`}
											onChange={(event) => change(key, event.target.value)}
										/>
									</div>
								);
							})}
						</div>
					);
				},
			)}
			<p
				id={`${id}-scene-status`}
				role={validation.error ? "alert" : "status"}
				className={
					validation.error ? "text-destructive" : "text-muted-foreground"
				}
			>
				{validation.error ??
					"No defaults or clamps. Final scene and compiler admission remain authoritative."}
			</p>
		</fieldset>
	);
}
