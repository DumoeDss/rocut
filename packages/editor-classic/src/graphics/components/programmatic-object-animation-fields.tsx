import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { particleDraft } from "./programmatic-particle-data";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import {
	animationCatalogResource,
	type InspectAnimation,
} from "./programmatic-animation-catalog-data";
import { ProgrammaticAnimationCatalogFields } from "./programmatic-animation-catalog-fields";
import {
	editObjectAnimationDraft,
	objectAnimationDraft,
	objectAnimationFieldsVisible,
	objectAnimationClipType,
	objectAnimationAuthoringAvailable,
	authorObjectAnimation,
} from "./programmatic-object-animation-data";

/** Presentation over the existing JSON draft; Apply/history remain with the build editor. */
export function ProgrammaticObjectAnimationFields({
	id,
	state,
	canCompile,
	onEdit,
	onInspectAnimation,
}: {
	id: string;
	state: BuildDraftSnapshot;
	canCompile: boolean;
	onEdit: (patch: { inputProps: string }) => void;
	onInspectAnimation?: InspectAnimation;
}) {
	if (!objectAnimationFieldsVisible({ state })) return null;
	const animation = objectAnimationDraft({ text: state.inputProps });
	const clipType = objectAnimationClipType({ state });
	const disabled = !!state.phase || state.conflict || !canCompile;
	const resource = animationCatalogResource(state);
	const authoring = objectAnimationAuthoringAvailable(state);
	const draft = particleDraft(state.inputProps);
	if (authoring && draft && !Object.hasOwn(draft, "animation"))
		return (
			<fieldset
				disabled={disabled}
				className="border-input flex min-w-0 flex-col gap-2 rounded-md border p-2 text-xs"
			>
				<legend className="px-1">GLB animation fields</legend>
				<p className="text-muted-foreground">
					Animation is not enabled. Read archived clips to explicitly add
					playback.
				</p>
				{resource && (
					<ProgrammaticAnimationCatalogFields
						key={JSON.stringify(resource)}
						id={id}
						state={state}
						disabled={disabled}
						resource={resource}
						inspect={onInspectAnimation}
						onEdit={onEdit}
						adding
					/>
				)}
			</fieldset>
		);
	if (!animation)
		return (
			<p role="alert" className="text-destructive text-xs">
				Fix input props JSON and animation object to edit GLB animation fields.
				Your original text is retained.
			</p>
		);
	const change = ({
		key,
		next,
	}: {
		key: "clip" | "mode" | "speed" | "offset";
		next: unknown;
	}) => {
		if (disabled) return;
		if (key === "clip" && !clipType) return;
		const inputProps = editObjectAnimationDraft({
			text: state.inputProps,
			key,
			next,
			clipType,
		});
		if (inputProps !== undefined) onEdit({ inputProps });
	};
	const issues = [
		...(Object.hasOwn(animation, "clip") &&
		(clipType === "name"
			? typeof animation.clip !== "string" || !animation.clip
			: clipType !== "index" ||
				typeof animation.clip !== "number" ||
				!Number.isSafeInteger(animation.clip) ||
				animation.clip < 0)
			? ["animation.clip"]
			: []),
		...(Object.hasOwn(animation, "mode") &&
		animation.mode !== "loop" &&
		animation.mode !== "clamp"
			? ["animation.mode"]
			: []),
		...(["speed", "offset"] as const)
			.filter(
				(key) =>
					Object.hasOwn(animation, key) &&
					(typeof animation[key] !== "number" ||
						!Number.isFinite(animation[key])),
			)
			.map((key) => `animation.${key}`),
	];
	return (
		<fieldset
			disabled={disabled}
			className="border-input flex min-w-0 flex-col gap-2 rounded-md border p-2 text-xs"
		>
			<legend className="px-1">GLB animation fields</legend>
			{authoring && (
				<Button
					disabled={disabled}
					onClick={() => {
						if (disabled) return;
						const inputProps = authorObjectAnimation({ state });
						if (inputProps !== undefined) onEdit({ inputProps });
					}}
				>
					Remove animation
				</Button>
			)}
			<p className="text-muted-foreground">
				Edit existing clip controls; clip availability and absolute-time
				playback are checked by the archived scene. Missing values are not
				generated.
			</p>
			{resource && (
				<ProgrammaticAnimationCatalogFields
					key={JSON.stringify(resource)}
					id={id}
					state={state}
					disabled={disabled}
					resource={resource}
					inspect={onInspectAnimation}
					onEdit={onEdit}
				/>
			)}
			{clipType === "name" && typeof animation.clip === "string" && (
				<div className="flex min-w-0 flex-col gap-1">
					<label htmlFor={`${id}-animation-clip`}>animation.clip</label>
					<Input
						id={`${id}-animation-clip`}
						size="xs"
						value={animation.clip}
						disabled={disabled}
						onChange={(event) =>
							change({ key: "clip", next: event.target.value })
						}
					/>
				</div>
			)}
			{clipType === "index" &&
				typeof animation.clip === "number" &&
				Number.isSafeInteger(animation.clip) &&
				animation.clip >= 0 && (
					<div className="flex min-w-0 flex-col gap-1">
						<label htmlFor={`${id}-animation-clip`}>
							animation.clip (zero-based index)
						</label>
						<Input
							id={`${id}-animation-clip`}
							size="xs"
							type="number"
							step="1"
							value={animation.clip}
							disabled={disabled}
							onChange={(event) => {
								if (event.target.value.trim())
									change({ key: "clip", next: event.target.valueAsNumber });
							}}
						/>
					</div>
				)}
			{(animation.mode === "loop" || animation.mode === "clamp") && (
				<div className="flex min-w-0 flex-col gap-1">
					<label htmlFor={`${id}-animation-mode`}>animation.mode</label>
					<select
						id={`${id}-animation-mode`}
						value={animation.mode}
						disabled={disabled}
						className="bg-background text-foreground border-input focus-visible:ring-ring h-8 min-w-0 rounded-md border px-2 text-xs focus-visible:ring-2"
						onChange={(event) =>
							change({ key: "mode", next: event.target.value })
						}
					>
						<option value="loop">loop</option>
						<option value="clamp">clamp</option>
					</select>
				</div>
			)}
			{(["speed", "offset"] as const).map((key) =>
				typeof animation[key] === "number" &&
				Number.isFinite(animation[key]) ? (
					<div key={key} className="flex min-w-0 flex-col gap-1">
						<label htmlFor={`${id}-animation-${key}`}>animation.{key}</label>
						<Input
							id={`${id}-animation-${key}`}
							size="xs"
							type="number"
							step="any"
							value={animation[key]}
							disabled={disabled}
							onChange={(event) => {
								if (
									event.target.value.trim() &&
									Number.isFinite(event.target.valueAsNumber)
								)
									change({ key, next: event.target.valueAsNumber });
							}}
						/>
					</div>
				) : null,
			)}
			{issues.length > 0 && (
				<p role="alert" className="text-destructive text-xs">
					Fix these values in Input props (JSON): {issues.join(", ")}.
				</p>
			)}
		</fieldset>
	);
}
