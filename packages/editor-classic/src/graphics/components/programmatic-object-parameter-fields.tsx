import { Input } from "../../components/ui/input";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import {
	OBJECT_PARAMETER_FIELDS,
	editObjectParameterDraft,
	objectParameterDraft,
	objectParameterKind,
	objectParameterValueValid,
} from "./programmatic-object-parameter-data";

/** Draft presentation only. The existing build Apply and history own source replacement. */
export function ProgrammaticObjectParameterFields({
	id,
	state,
	canCompile,
	onEdit,
}: {
	id: string;
	state: BuildDraftSnapshot;
	canCompile: boolean;
	onEdit: (patch: { inputProps: string }) => void;
}) {
	const kind = objectParameterKind({ state });
	if (!kind) return null;
	const params = objectParameterDraft({ text: state.inputProps, kind });
	if (!params)
		return (
			<p role="alert" className="text-destructive text-xs">
				Fix input props JSON and {kind} object to edit object parameter fields.
				Your original text is retained.
			</p>
		);
	const disabled = !!state.phase || state.conflict || !canCompile;
	const fields = OBJECT_PARAMETER_FIELDS[kind].filter((field) =>
		Object.hasOwn(params, field.key),
	);
	const issues = fields.filter(
		(field) => !objectParameterValueValid({ field, value: params[field.key] }),
	);
	const change = ({ key, next }: { key: string; next: unknown }) => {
		if (disabled) return;
		const inputProps = editObjectParameterDraft({
			text: state.inputProps,
			kind,
			key,
			next,
		});
		if (inputProps !== undefined) onEdit({ inputProps });
	};
	return (
		<fieldset
			disabled={disabled}
			className="border-input flex min-w-0 flex-col gap-2 rounded-md border p-2 text-xs"
		>
			<legend className="px-1">
				{kind === "glass" ? "Glass" : kind === "ink" ? "Ink" : "Liquid"} object
				fields
			</legend>
			<p className="text-muted-foreground">
				Edit existing public parameters. Missing values are not generated;
				version, seed and mapped-frame clocks remain unchanged. Values are
				transported without range clamps or color normalization.
			</p>
			{fields
				.filter((field) =>
					objectParameterValueValid({ field, value: params[field.key] }),
				)
				.map((field) => {
					const fieldId = `${id}-object-${kind}-${field.key}`,
						value = params[field.key];
					return (
						<div key={fieldId} className="flex min-w-0 flex-col gap-1">
							<label htmlFor={fieldId}>
								{kind}.{field.key}
								{field.type === "rgb" ? " (RGB)" : ""}
							</label>
							{field.type === "boolean" ? (
								<input
									id={fieldId}
									type="checkbox"
									checked={value as boolean}
									disabled={disabled}
									className="accent-primary h-4 w-4"
									onChange={(event) =>
										change({ key: field.key, next: event.target.checked })
									}
								/>
							) : (
								<Input
									id={fieldId}
									size="xs"
									type={field.type === "number" ? "number" : "text"}
									step={field.type === "number" ? "any" : undefined}
									value={value as string | number}
									disabled={disabled}
									onChange={(event) => {
										if (field.type === "rgb")
											change({ key: field.key, next: event.target.value });
										else if (
											event.target.value.trim() &&
											Number.isFinite(event.target.valueAsNumber)
										)
											change({
												key: field.key,
												next: event.target.valueAsNumber,
											});
									}}
								/>
							)}
						</div>
					);
				})}
			{issues.length > 0 && (
				<p role="alert" className="text-destructive text-xs">
					Fix these values in Input props (JSON):{" "}
					{issues.map((field) => `${kind}.${field.key}`).join(", ")}.
				</p>
			)}
		</fieldset>
	);
}
