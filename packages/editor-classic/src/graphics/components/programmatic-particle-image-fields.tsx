import { Input } from "../../components/ui/input";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import {
	particleDraft,
	particleFieldsDisabled,
	particleRecord,
} from "./programmatic-particle-data";
import {
	editParticleImageDraft,
	particleImageFieldsVisible,
	particleImageResources,
} from "./programmatic-particle-image-data";

export function ProgrammaticParticleImageFields({
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
	if (!particleImageFieldsVisible(state)) return null;
	const props = particleDraft(state.inputProps),
		disabled = particleFieldsDisabled({ state, canCompile });
	if (!props)
		return (
			<p role="alert">
				Fix input props JSON to edit image surface fields. Original text is
				retained.
			</p>
		);
	const resources = particleImageResources(state),
		plane = particleRecord(props.plane),
		issues: string[] = [];
	const change = (
		key: "imageId" | "width" | "height" | "alphaTest",
		next: unknown,
	) => {
		const inputProps = editParticleImageDraft({ state, canCompile, key, next });
		if (inputProps !== undefined && inputProps !== state.inputProps)
			onEdit({ inputProps });
	};
	const fields = (["width", "height", "alphaTest"] as const).map((key) => {
		const root = key === "alphaTest" ? props : plane;
		if (!root || !Object.hasOwn(root, key)) return null;
		const value = root[key];
		if (
			typeof value !== "number" ||
			!Number.isFinite(value) ||
			(key === "alphaTest" ? value < 0 || value > 1 : value <= 0)
		) {
			issues.push(key === "alphaTest" ? key : `plane.${key}`);
			return null;
		}
		const fieldId = `${id}-particle-image-${key}`;
		return (
			<div key={key} className="flex min-w-0 flex-col gap-1">
				<label htmlFor={fieldId}>
					{key === "alphaTest"
						? "alphaTest (0..1)"
						: `plane.${key} (scene units)`}
				</label>
				<Input
					id={fieldId}
					size="xs"
					type="number"
					step="any"
					value={value}
					disabled={disabled}
					onChange={(event) => {
						if (event.target.value.trim())
							change(key, event.target.valueAsNumber);
					}}
				/>
			</div>
		);
	});
	if (Object.hasOwn(props, "plane") && !plane) issues.push("plane");
	if (typeof props.imageId !== "string") issues.push("imageId");
	return (
		<fieldset
			disabled={disabled}
			className="border-input flex min-w-0 flex-col gap-2 rounded-md border p-2 text-xs"
		>
			<legend>Particle image surface</legend>
			{typeof props.imageId === "string" && (
				<div className="flex min-w-0 flex-col gap-1">
					<label htmlFor={`${id}-particle-image-id`}>
						imageId (archived images)
					</label>
					<select
						id={`${id}-particle-image-id`}
						value={props.imageId}
						disabled={disabled}
						className="bg-background text-foreground border-input h-8 min-w-0 rounded-md border px-2 text-xs"
						onChange={(event) => change("imageId", event.target.value)}
					>
						{!resources.some((resource) => resource.id === props.imageId) && (
							<option value={props.imageId}>
								Unknown image: {props.imageId || "(empty)"}
							</option>
						)}
						{resources.map((resource) => (
							<option key={resource.id} value={resource.id}>
								{resource.id} ({resource.mimeType})
							</option>
						))}
					</select>
				</div>
			)}
			{fields}
			<p className="text-muted-foreground">
				Choose only an archived image. Width and height are explicit scene
				units; no aspect ratio or sampling density is changed. Missing plane
				fields stay omitted.
			</p>
			{issues.length > 0 && (
				<p role="alert" className="text-destructive">
					Fix these values in Input props (JSON): {issues.join(", ")}. Original
					text is retained.
				</p>
			)}
		</fieldset>
	);
}
