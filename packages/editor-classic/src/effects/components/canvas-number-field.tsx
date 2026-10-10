import { usePropertyDraft } from "../../components/editor/panels/properties/hooks/use-property-draft";
import { NumberField } from "../../components/ui/number-field";
import { SectionField } from "../../components/section";
import type { ParamDefinition, ParamValue } from "../../params";
import { canvasTypedValue } from "./canvas-stroke-edit";

export function CanvasNumberField({
	param,
	value,
	onPreview,
	onCommit,
}: {
	param: ParamDefinition;
	value: ParamValue | undefined;
	onPreview: (value: ParamValue) => void;
	onCommit: () => void;
}) {
	const draft = usePropertyDraft<ParamValue>({
		displayValue: value === undefined ? "" : String(value),
		parse: (input) => canvasTypedValue({ input }),
		onPreview,
		onCommit,
		supportsExpressions: false,
	});
	const invalid =
		param.type === "number" &&
		(typeof value !== "number" ||
			!Number.isFinite(value) ||
			value < param.min ||
			(param.max !== undefined && value > param.max));
	return (
		<SectionField label={param.label}>
			<NumberField
				aria-label={param.label}
				aria-invalid={invalid}
				data-testid={`effect-canvas-input-${param.key}`}
				value={draft.displayValue}
				onFocus={draft.onFocus}
				onChange={draft.onChange}
				onBlur={draft.onBlur}
				isDefault={value === param.default}
				onReset={() => {
					onPreview(param.default);
					onCommit();
				}}
			/>
			{param.type === "number" && (
				<span className="text-xs text-muted-foreground">
					{param.min} – {param.max ?? "∞"}
					{invalid ? " · Check this value" : ""}
				</span>
			)}
		</SectionField>
	);
}
