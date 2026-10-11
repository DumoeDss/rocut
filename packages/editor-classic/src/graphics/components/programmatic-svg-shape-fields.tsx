import { useState } from "react";
import { Input } from "../../components/ui/input";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import { particleFieldsDisabled } from "./programmatic-particle-data";
import {
	changeSvgShapeText,
	editSvgShapeDraft,
	svgShapeNumberFields,
	svgShapeTexts,
	svgShapeVisible,
	type SvgShapeTexts,
} from "./programmatic-svg-shape-data";
type Props = {
	id: string;
	state: BuildDraftSnapshot;
	canCompile: boolean;
	onEdit: (patch: { inputProps: string }) => void;
};
export function ProgrammaticSvgShapeFields(props: Props) {
	if (!svgShapeVisible(props.state)) return null;
	const initial = svgShapeTexts(props.state);
	if (!initial)
		return (
			<p role="alert" className="text-destructive text-xs">
				Fix complete Input props JSON first. Your original text is retained.
			</p>
		);
	return (
		<ShapeFields key={props.state.inputProps} {...props} initial={initial} />
	);
}
function ShapeFields({
	id,
	state,
	canCompile,
	onEdit,
	initial,
}: Props & { initial: SvgShapeTexts }) {
	const [texts, setTexts] = useState(initial),
		disabled = particleFieldsDisabled({ state, canCompile }),
		validation = editSvgShapeDraft({ state, texts });
	const change = (key: keyof SvgShapeTexts, next: string) => {
		const result = changeSvgShapeText({ state, canCompile, texts, key, next });
		if (!result) return;
		setTexts(result.texts);
		if (
			result.inputProps !== undefined &&
			result.inputProps !== state.inputProps
		)
			onEdit({ inputProps: result.inputProps });
	};
	const statusId = `${id}-svg-shape-status`;
	return (
		<fieldset
			disabled={disabled}
			className="border-input flex min-w-0 flex-col gap-2 rounded-md border p-2 text-xs"
		>
			<legend className="px-1">SVG geometry</legend>
			<p className="text-muted-foreground">
				Static filled SVG only. Depth uses the original SVG viewBox units. Bevel
				is unsupported and stays off. Apply through Recompile and apply.
			</p>
			<label htmlFor={`${id}-svg-kind`}>SVG modeling</label>
			<select
				id={`${id}-svg-kind`}
				value={texts.kind}
				disabled={disabled}
				aria-invalid={!!validation.error}
				aria-describedby={statusId}
				className="border-input bg-background rounded-md border px-2 py-1"
				onChange={(event) => change("kind", event.target.value)}
			>
				<option value="flat">Flat</option>
				<option value="extrude">Extrude</option>
			</select>
			{texts.kind === "extrude" && (
				<div className="flex min-w-0 flex-col gap-1">
					<label htmlFor={`${id}-svg-depth`}>SVG depth (viewBox units)</label>
					<Input
						id={`${id}-svg-depth`}
						size="xs"
						value={texts.depth}
						disabled={disabled}
						spellCheck={false}
						aria-invalid={!!validation.error}
						aria-describedby={statusId}
						onChange={(event) => change("depth", event.target.value)}
					/>
				</div>
			)}
			{svgShapeNumberFields.map((field) => (
				<div key={field.key} className="flex min-w-0 flex-col gap-1">
					<label htmlFor={`${id}-svg-${field.key}`}>{field.label}</label>
					<Input
						id={`${id}-svg-${field.key}`}
						size="xs"
						value={texts[field.key]}
						placeholder="Not declared; no value generated"
						disabled={disabled}
						spellCheck={false}
						aria-invalid={!!validation.error}
						aria-describedby={statusId}
						onChange={(event) => change(field.key, event.target.value)}
					/>
				</div>
			))}
			<p
				id={statusId}
				role={validation.error ? "alert" : "status"}
				className={
					validation.error ? "text-destructive" : "text-muted-foreground"
				}
			>
				{validation.error ??
					"Blank optional values stay absent. Runtime SVG limits and compiler admission remain authoritative."}
			</p>
		</fieldset>
	);
}
