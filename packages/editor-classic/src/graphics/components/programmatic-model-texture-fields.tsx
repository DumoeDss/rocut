import { useState } from "react";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import {
	particleDraft,
	particleFieldsDisabled,
} from "./programmatic-particle-data";
import {
	blankModelTexture,
	editModelTexture,
	modelTextureContext,
	modelTextureTexts,
	modelTextureConsumerIssue,
	MODEL_TEXTURE_SLOTS,
	type ModelTextureTexts,
} from "./programmatic-model-texture-data";
import { sourceFingerprint } from "./programmatic-source-draft";
type Props = {
	id: string;
	state: BuildDraftSnapshot;
	canCompile: boolean;
	onEdit: (patch: { inputProps: string }) => void;
};
export function ProgrammaticModelTextureFields(props: Props) {
	const context = modelTextureContext(props.state);
	if (!context) {
		const build = props.state.baseline.build;
		return build?.entryFile === "model-feature-scene.ts" &&
			build.inputProps?.assetKind === "model" &&
			modelTextureConsumerIssue(props.state) ? (
			<p role="status" className="text-muted-foreground text-xs">
				{modelTextureConsumerIssue(props.state)}
			</p>
		) : null;
	}
	const draft = particleDraft(props.state.inputProps);
	if (
		!draft ||
		draft.assetKind !== "model" ||
		(draft.textureBindings !== undefined &&
			!Array.isArray(draft.textureBindings))
	)
		return (
			<p role="alert" className="text-destructive text-xs">
				Fix model Input props / textureBindings JSON first. Original values are
				retained.
			</p>
		);
	const bindings = (draft.textureBindings ?? []) as unknown[];
	const disabled = particleFieldsDisabled(props);
	return (
		<fieldset
			disabled={disabled}
			className="border-input flex min-w-0 flex-col gap-2 rounded-md border p-2 text-xs"
		>
			<legend>Archived model texture bindings</legend>
			<p className="text-muted-foreground">
				Declared images only. Type the exact unique mesh name and zero-based
				material index. Choose slot and flipY explicitly; final scene admission
				validates the model. Use the existing Recompile and apply.
			</p>
			{bindings.map((binding, index) => (
				<TextureRow
					key={`${index}:${JSON.stringify(binding)}`}
					{...props}
					index={index}
					initial={modelTextureTexts(binding)}
					images={context.images}
					retained={binding}
				/>
			))}
			{bindings.length < 64 && (
				<TextureRow
					key={`new:${sourceFingerprint(props.state.baseline)}`}
					{...props}
					images={context.images}
					initial={blankModelTexture()}
				/>
			)}
		</fieldset>
	);
}
function TextureRow({
	id,
	state,
	canCompile,
	onEdit,
	index,
	initial,
	images,
	retained,
}: Props & {
	index?: number;
	initial?: ModelTextureTexts;
	images: string[];
	retained?: unknown;
}) {
	const [texts, setTexts] = useState(initial),
		[error, setError] = useState<string>();
	const disabled = particleFieldsDisabled({ state, canCompile });
	const prefix = `${id}-texture-${index ?? "new"}`;
	const change = (key: keyof ModelTextureTexts, next: string) => {
		if (disabled || !texts) return;
		const nextTexts = { ...texts, [key]: next };
		setTexts(nextTexts);
		if (index === undefined) {
			setError(undefined);
			return;
		}
		const result = editModelTexture({
			state,
			canCompile,
			index,
			texts: nextTexts,
		});
		setError(result.error);
		if (result.inputProps !== undefined)
			onEdit({ inputProps: result.inputProps });
	};
	return (
		<fieldset
			className="flex min-w-0 flex-col gap-2 rounded border p-2"
			disabled={disabled}
		>
			<legend>
				{index === undefined ? "New binding" : `Binding ${index}`}
			</legend>
			{!texts ? (
				<p role="alert">
					Unrecognized binding retained: {JSON.stringify(retained)}. Use
					advanced JSON or Remove explicitly.
				</p>
			) : (
				<>
					{index !== undefined &&
						Object.values(texts).some((value) => value === "") && (
							<p role="status">
								Incomplete or invalid binding retained:{" "}
								{JSON.stringify(retained)}. Fill blank fields explicitly; other
								edits do not repair their types.
							</p>
						)}
					<label htmlFor={`${prefix}-imageId`}>
						Declared texture image
						<select
							id={`${prefix}-imageId`}
							value={texts.imageId}
							disabled={disabled}
							onChange={(event) => change("imageId", event.target.value)}
							className="bg-input rounded border p-1"
						>
							<option value="">Choose an image explicitly</option>
							{texts.imageId && !images.includes(texts.imageId) && (
								<option value={texts.imageId}>
									Unavailable image (retained): {texts.imageId}
								</option>
							)}
							{images.map((image) => (
								<option key={image} value={image}>
									{image}
								</option>
							))}
						</select>
					</label>
					{(["mesh", "material"] as const).map((key) => (
						<label key={key} htmlFor={`${prefix}-${key}`}>
							{key === "mesh"
								? "Unique mesh name"
								: "Zero-based material integer"}
							<Input
								id={`${prefix}-${key}`}
								size="xs"
								value={texts[key]}
								disabled={disabled}
								onChange={(event) => change(key, event.target.value)}
								spellCheck={false}
							/>
						</label>
					))}
					<label htmlFor={`${prefix}-slot`}>
						Slot
						<select
							id={`${prefix}-slot`}
							value={texts.slot}
							disabled={disabled}
							onChange={(event) => change("slot", event.target.value)}
							className="bg-input rounded border p-1"
						>
							<option value="">Choose a slot explicitly</option>
							{texts.slot &&
								!(MODEL_TEXTURE_SLOTS as readonly string[]).includes(
									texts.slot,
								) && (
									<option value={texts.slot}>
										Unknown slot (retained): {texts.slot}
									</option>
								)}
							{MODEL_TEXTURE_SLOTS.map((slot) => (
								<option key={slot} value={slot}>
									{slot}
								</option>
							))}
						</select>
					</label>
					<label htmlFor={`${prefix}-flipY`}>
						flipY
						<select
							id={`${prefix}-flipY`}
							value={texts.flipY}
							disabled={disabled}
							onChange={(event) => change("flipY", event.target.value)}
							className="bg-input rounded border p-1"
						>
							<option value="">Choose orientation explicitly</option>
							{texts.flipY && !["true", "false"].includes(texts.flipY) && (
								<option value={texts.flipY}>
									Invalid value (retained): {texts.flipY}
								</option>
							)}
							<option value="false">false — original orientation</option>
							<option value="true">true — vertical flip</option>
						</select>
					</label>
				</>
			)}
			{error && (
				<p role="alert" className="text-destructive">
					{error}
				</p>
			)}
			{index === undefined ? (
				<Button
					size="sm"
					variant="outline"
					aria-label="Add texture binding"
					disabled={disabled}
					onClick={() => {
						if (disabled) return;
						const result = editModelTexture({ state, canCompile, texts });
						setError(result.error);
						if (result.inputProps !== undefined) {
							setTexts(blankModelTexture());
							onEdit({ inputProps: result.inputProps });
						}
					}}
				>
					Add binding
				</Button>
			) : (
				<Button
					size="sm"
					variant="ghost"
					aria-label={`Remove texture binding ${index}`}
					disabled={disabled}
					onClick={() => {
						if (disabled) return;
						const result = editModelTexture({
							state,
							canCompile,
							index,
							remove: true,
						});
						setError(result.error);
						if (result.inputProps !== undefined)
							onEdit({ inputProps: result.inputProps });
					}}
				>
					Remove binding
				</Button>
			)}
		</fieldset>
	);
}
