import { useState } from "react";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import { particleFieldsDisabled } from "./programmatic-particle-data";
import {
	changeParticleInstanceTexts,
	editParticleInstanceDraft,
	particleInstanceFieldsVisible,
	particleInstanceTexts,
	type ParticleInstanceTexts,
} from "./programmatic-particle-instance-data";

type Props = {
	id: string;
	state: BuildDraftSnapshot;
	canCompile: boolean;
	onEdit: (patch: { inputProps: string }) => void;
};
/** Only edits the existing build draft; no separate Apply, history or clock. */
export function ProgrammaticParticleInstanceFields(props: Props) {
	if (!particleInstanceFieldsVisible({ state: props.state })) return null;
	const drafts = particleInstanceTexts(props.state.inputProps);
	if (!drafts)
		return (
			<p role="alert" className="text-destructive text-xs">
				Fix complete Input props JSON and existing instances first. Your
				original text is retained.
			</p>
		);
	// A genuine external JSON edit/Discard/source refresh resets local text; invalid
	// textarea edits never change this key and therefore remain visible locally.
	return (
		<InstanceTextFields
			key={props.state.inputProps}
			{...props}
			initial={drafts}
		/>
	);
}
function InstanceTextFields({
	id,
	state,
	canCompile,
	onEdit,
	initial,
}: Props & { initial: ParticleInstanceTexts }) {
	const [drafts, setDrafts] = useState(initial);
	const disabled = particleFieldsDisabled({ state, canCompile });
	const validation = editParticleInstanceDraft({
		text: state.inputProps,
		drafts,
	});
	const change = (key: keyof ParticleInstanceTexts, next: string) => {
		const result = changeParticleInstanceTexts({
			state,
			canCompile,
			drafts,
			key,
			next,
		});
		if (!result) return;
		setDrafts(result.drafts);
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
			<legend className="px-1">Static Particle instances</legend>
			<p className="text-muted-foreground">
				Count: {validation.count ?? "invalid"}. Edit existing explicit
				column-major matrices (1..64). Optional colors are linear RGB
				multipliers [0,1], not sRGB or alpha. Change both arrays to matching
				lengths; invalid local text is retained. Compiler/native admission
				remains authoritative. Use the existing Recompile and apply action.
			</p>
			{(["instances", "instanceColors"] as const).map((key) =>
				drafts[key] === undefined ? null : (
					<div key={key} className="flex min-w-0 flex-col gap-1">
						<label htmlFor={`${id}-${key}`}>{key} (JSON)</label>
						<textarea
							id={`${id}-${key}`}
							value={drafts[key]}
							disabled={disabled}
							rows={6}
							spellCheck={false}
							aria-invalid={!!validation.error}
							aria-describedby={`${id}-instance-status`}
							className="bg-background text-foreground border-input min-w-0 rounded-md border p-2 font-mono text-xs"
							onChange={(event) => change(key, event.target.value)}
						/>
					</div>
				),
			)}
			<p
				id={`${id}-instance-status`}
				role={validation.error ? "alert" : "status"}
				className={
					validation.error ? "text-destructive" : "text-muted-foreground"
				}
			>
				{validation.error ??
					"Valid presentation structure; singular matrices and source/material budgets are checked when compiled."}
			</p>
		</fieldset>
	);
}
