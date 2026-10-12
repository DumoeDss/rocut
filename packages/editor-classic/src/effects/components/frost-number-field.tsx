import type { ComponentProps } from "react";
import { PropertyParamField } from "../../components/editor/panels/properties/components/property-param-field";
import { KeyframeToggle } from "../../components/editor/panels/properties/components/keyframe-toggle";
import { usePropertyDraft } from "../../components/editor/panels/properties/hooks/use-property-draft";
import { NumberField } from "../../components/ui/number-field";
import { SectionField } from "../../components/section";
import type { ParamDefinition, ParamValue } from "../../params";
import { frostTypedValue } from "./frost-stroke-edit";

export function FrostNumberField({
	param,
	value,
	onPreview,
	onCommit,
	keyframe,
}: {
	param: ParamDefinition;
	value: ParamValue | undefined;
	onPreview: (value: ParamValue) => void;
	onCommit: () => void;
	keyframe?: ComponentProps<typeof PropertyParamField>["keyframe"];
}) {
	const draft = usePropertyDraft<ParamValue>({
		displayValue: value === undefined ? "" : String(value),
		parse: (input) => frostTypedValue({ input }),
		onPreview,
		onCommit,
		supportsExpressions: false,
	});
	if (param.type !== "number")
		return (
			<PropertyParamField
				param={param}
				value={value ?? param.default}
				onPreview={onPreview}
				onCommit={onCommit}
				keyframe={keyframe}
			/>
		);
	const invalid =
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < param.min ||
		(param.max !== undefined && value > param.max);
	return (
		<SectionField
			label={param.label}
			beforeLabel={
				keyframe && param.keyframable !== false ? (
					<KeyframeToggle
						isActive={keyframe.isActive}
						isDisabled={keyframe.isDisabled}
						title={`Toggle ${param.label.toLowerCase()} keyframe`}
						onToggle={keyframe.onToggle}
					/>
				) : undefined
			}
		>
			<NumberField
				aria-label={param.label}
				aria-invalid={invalid}
				data-testid={`effect-frost-input-${param.key}`}
				value={draft.displayValue}
				isDefault={value === param.default}
				onFocus={draft.onFocus}
				onChange={draft.onChange}
				onBlur={draft.onBlur}
				onReset={() => {
					onPreview(param.default);
					onCommit();
				}}
			/>
		</SectionField>
	);
}
