import type { ReactNode } from "react";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import { ProgrammaticParticleImageFields } from "./programmatic-particle-image-fields";
import {
	editParticleDraft,
	particleDraft,
	particleFieldsDisabled,
	particleFieldsVisible,
	particleRecord,
} from "./programmatic-particle-data";

/** Editor conveniences only. The existing JSON draft, compiler and history own Apply. */
export function ProgrammaticParticleFields({
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
	if (!particleFieldsVisible(state)) return null;
	const disabled = particleFieldsDisabled({ state, canCompile }),
		props = particleDraft(state.inputProps);
	if (!props)
		return (
			<p className="text-destructive text-xs" role="alert">
				Fix input props JSON to edit Particle fields. Your original text is
				retained.
			</p>
		);
	const fields: ReactNode[] = [],
		issues: string[] = [];
	const change = ({
		path,
		next,
	}: {
		path: readonly (string | number)[];
		next: unknown;
	}) => {
		if (disabled) return;
		const text = editParticleDraft({ text: state.inputProps, path, next });
		if (text !== undefined) onEdit({ inputProps: text });
	};
	const number = ({
		value,
		path,
		label,
	}: {
		value: unknown;
		path: (string | number)[];
		label: string;
	}) => {
		if (typeof value !== "number" || !Number.isFinite(value)) {
			issues.push(label);
			return;
		}
		const fieldId = `${id}-particle-${path.join("-")}`;
		fields.push(
			<div key={fieldId} className="flex min-w-0 flex-col gap-1">
				<label htmlFor={fieldId}>{label}</label>
				<Input
					id={fieldId}
					size="xs"
					type="number"
					step="any"
					value={value}
					disabled={disabled}
					onChange={(event) => {
						if (
							event.target.value.trim() &&
							Number.isFinite(event.target.valueAsNumber)
						)
							change({ path, next: event.target.valueAsNumber });
					}}
				/>
			</div>,
		);
	};
	const scalars = ({
		value,
		path,
		keys,
	}: {
		value: Record<string, unknown>;
		path: string[];
		keys: string[];
	}) => {
		for (const key of keys)
			if (Object.hasOwn(value, key))
				number({
					value: value[key],
					path: [...path, key],
					label: [...path, key].join("."),
				});
	};
	const vector = ({ value, path }: { value: unknown; path: string[] }) => {
		if (
			!Array.isArray(value) ||
			value.length !== 3 ||
			!value.every(
				(entry) => typeof entry === "number" && Number.isFinite(entry),
			)
		) {
			issues.push(path.join("."));
			return;
		}
		value.forEach((entry, index) =>
			number({
				value: entry,
				path: [...path, index],
				label: `${path.join(".")} ${["X", "Y", "Z"][index]}`,
			}),
		);
	};
	scalars({ value: props, path: [], keys: ["count", "scale"] });
	if (Object.hasOwn(props, "rotationSpeed"))
		vector({ value: props.rotationSpeed, path: ["rotationSpeed"] });
	const motion = particleRecord(props.motion);
	if (motion)
		scalars({
			value: motion,
			path: ["motion"],
			keys: [
				"scatterStartTicks",
				"scatterDurationTicks",
				"holdDurationTicks",
				"returnDurationTicks",
				"scatterDistance",
				"driftAmplitude",
				"driftFrequency",
				"size",
				"sizeVariance",
			],
		});
	else if (Object.hasOwn(props, "motion")) issues.push("motion");
	const control = particleRecord(motion?.control);
	if (control) {
		if (typeof control.mode === "string") {
			const fieldId = `${id}-particle-motion-control-mode`;
			fields.push(
				<div key={fieldId} className="flex min-w-0 flex-col gap-1">
					<label htmlFor={fieldId}>motion.control.mode</label>
					<select
						id={fieldId}
						value={control.mode}
						disabled={disabled}
						className="bg-background text-foreground border-input focus-visible:ring-ring h-7 min-w-0 rounded-md border px-2 text-xs focus-visible:ring-2"
						onChange={(event) =>
							change({
								path: ["motion", "control", "mode"],
								next: event.target.value,
							})
						}
					>
						{!["spring", "vortex"].includes(control.mode) && (
							<option value={control.mode}>{control.mode}</option>
						)}
						<option value="spring">Spring</option>
						<option value="vortex">Vortex</option>
					</select>
				</div>,
			);
		} else if (Object.hasOwn(control, "mode"))
			issues.push("motion.control.mode");
		scalars({
			value: control,
			path: ["motion", "control"],
			keys: [
				"startTicks",
				"durationTicks",
				"restoringForce",
				"damping",
				"radius",
				"strength",
			],
		});
		if (Object.hasOwn(control, "axis"))
			vector({ value: control.axis, path: ["motion", "control", "axis"] });
	} else if (motion && Object.hasOwn(motion, "control"))
		issues.push("motion.control");
	const knots = control?.knots,
		knotsId = `${id}-particle-motion-control-knots`;
	if (control && Object.hasOwn(control, "knots") && !Array.isArray(knots))
		issues.push("motion.control.knots");
	return (
		<fieldset
			disabled={disabled}
			className="flex min-w-0 flex-col gap-2 border-t pt-2 text-xs"
		>
			<legend className="pt-2">Particle fields</legend>
			<ProgrammaticParticleImageFields
				id={id}
				state={state}
				canCompile={canCompile}
				onEdit={onEdit}
			/>
			<p className="text-muted-foreground">
				Only existing values are shown. Edit input props JSON to add missing
				values. Rust checks ranges and schedules when you Recompile and apply.
			</p>
			<div className="grid min-w-0 grid-cols-2 gap-2">{fields}</div>
			{Array.isArray(knots) && (
				<>
					<label htmlFor={knotsId}>Control knots (JSON)</label>
					<Textarea
						key={JSON.stringify(knots)}
						id={knotsId}
						defaultValue={JSON.stringify(knots, null, 2)}
						disabled={disabled}
						spellCheck={false}
						className="h-28 resize-y font-mono text-xs md:text-xs"
						aria-describedby={`${knotsId}-help`}
						onChange={(event) => {
							if (disabled) return;
							try {
								const next: unknown = JSON.parse(event.target.value);
								if (
									!Array.isArray(next) ||
									!particleDraft(`{"knots":${event.target.value}}`)
								)
									throw Error("Invalid knots JSON");
								event.target.setCustomValidity?.("");
								event.target.setAttribute?.("aria-invalid", "false");
								change({ path: ["motion", "control", "knots"], next });
							} catch {
								event.target.setCustomValidity?.(
									"Fix control knots JSON: enter a JSON array. Your text is retained.",
								);
								event.target.setAttribute?.("aria-invalid", "true");
								event.target.reportValidity?.();
							}
						}}
					/>
					<p id={`${knotsId}-help`} className="text-muted-foreground">
						Incomplete JSON stays in this box. Fix it to update the draft; no
						knots, source ticks or axis are generated automatically.
					</p>
				</>
			)}
			{issues.length > 0 && (
				<p className="text-destructive" role="alert">
					Fix these values in input props JSON: {issues.join(", ")}. The
					original values are retained.
				</p>
			)}
		</fieldset>
	);
}
