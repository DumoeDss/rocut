import { useEffect, useRef, useState } from "react";
import type { ProgrammaticResource } from "@opencut/editor-contracts";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { BuildDraftSnapshot } from "./programmatic-build-draft";
import {
	objectAnimationClipType,
	objectAnimationDraft,
	objectAnimationAuthoringIndexesAvailable,
} from "./programmatic-object-animation-data";
import {
	readAnimationCatalog,
	catalogClipSelectable,
	selectAnimationCatalogClip,
	addAnimationCatalogClip,
	type AnimationCatalogClip,
	type InspectAnimation,
} from "./programmatic-animation-catalog-data";

/** Mounted with a resource identity key: catalogs never cross archived GLB changes. */
export function ProgrammaticAnimationCatalogFields({
	id,
	state,
	disabled,
	resource,
	inspect,
	onEdit,
	adding = false,
}: {
	id: string;
	state: BuildDraftSnapshot;
	disabled: boolean;
	resource: ProgrammaticResource;
	inspect?: InspectAnimation;
	onEdit: (patch: { inputProps: string }) => void;
	adding?: boolean;
}) {
	const [clips, setClips] = useState<AnimationCatalogClip[]>();
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const controller = useRef<AbortController | undefined>(undefined);
	useEffect(() => () => controller.current?.abort(), []);
	useEffect(() => {
		if (disabled) {
			controller.current?.abort();
			setLoading(false);
		}
	}, [disabled]);
	const read = async () => {
		if (disabled || loading || !inspect) return;
		controller.current?.abort();
		const pending = new AbortController();
		controller.current = pending;
		setLoading(true);
		setError("");
		setClips(undefined);
		try {
			setClips(await readAnimationCatalog(inspect, resource, pending.signal));
		} catch (error) {
			if (!pending.signal.aborted)
				setError(
					error instanceof Error
						? error.message
						: "Animation catalog unavailable",
				);
		} finally {
			if (!pending.signal.aborted) setLoading(false);
		}
	};
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<Button
				size="sm"
				variant="outline"
				disabled={disabled || loading || !inspect}
				onClick={() => void read()}
			>
				{loading ? "Reading GLB clips..." : "Read archived GLB clips"}
			</Button>
			{!inspect && (
				<p className="text-muted-foreground">
					{adding
						? "This host cannot read animation catalogs. Adding playback requires a catalog; original JSON remains editable."
						: "This host cannot read animation catalogs. Manual clip input remains available."}
				</p>
			)}
			{error && (
				<p role="alert" className="text-destructive">
					{error}. Continue with manual clip input or retry.
				</p>
			)}
			{clips &&
				(adding ? (
					<ProgrammaticAnimationAddFields
						id={id}
						state={state}
						clips={clips}
						disabled={disabled || loading}
						onEdit={onEdit}
					/>
				) : (
					<ProgrammaticAnimationCatalogChoices
						id={id}
						state={state}
						clips={clips}
						disabled={disabled || loading}
						onEdit={onEdit}
					/>
				))}
		</div>
	);
}

/** Playback values are visible for confirmation; the real clip is never preselected. */
export function ProgrammaticAnimationAddFields({
	id,
	state,
	clips,
	disabled,
	onEdit,
}: {
	id: string;
	state: BuildDraftSnapshot;
	clips: AnimationCatalogClip[];
	disabled: boolean;
	onEdit: (patch: { inputProps: string }) => void;
}) {
	const baselineType = objectAnimationClipType({ state });
	const [type, setType] = useState<"name" | "index">(baselineType ?? "name");
	const [selected, setSelected] = useState("");
	const [mode, setMode] = useState<"loop" | "clamp">("loop");
	const [speed, setSpeed] = useState("1"),
		[offset, setOffset] = useState("0");
	const blocked = disabled || !!state.phase || state.conflict;
	const inputProps =
		selected && speed.trim() && offset.trim()
			? addAnimationCatalogClip(
					state,
					clips,
					Number(selected),
					type,
					mode,
					Number(speed),
					Number(offset),
				)
			: undefined;
	return (
		<div className="flex min-w-0 flex-col gap-2">
			<label htmlFor={`${id}-animation-add-type`}>Clip selection</label>
			<select
				id={`${id}-animation-add-type`}
				value={type}
				disabled={blocked || !!baselineType}
				onChange={(event) => {
					if (!blocked && !baselineType) {
						setType(event.target.value as "name" | "index");
						setSelected("");
					}
				}}
			>
				<option value="name">Unique name</option>
				{objectAnimationAuthoringIndexesAvailable(state) && (
					<option value="index">Zero-based index</option>
				)}
			</select>
			<label htmlFor={`${id}-animation-add-clip`}>Archived GLB clip</label>
			<select
				id={`${id}-animation-add-clip`}
				value={selected}
				disabled={blocked}
				onChange={(event) => {
					if (!blocked) setSelected(event.target.value);
				}}
			>
				<option value="">Choose a clip (no default)</option>
				{clips.map((clip) => (
					<option
						key={clip.index}
						value={clip.index}
						disabled={!catalogClipSelectable(clip, clips, type)}
					>
						{clip.index}: {clip.name || "(unnamed)"} ({clip.duration} s)
					</option>
				))}
			</select>
			<label htmlFor={`${id}-animation-add-mode`}>animation.mode</label>
			<select
				id={`${id}-animation-add-mode`}
				value={mode}
				disabled={blocked}
				onChange={(event) => {
					if (!blocked) setMode(event.target.value as "loop" | "clamp");
				}}
			>
				<option value="loop">loop</option>
				<option value="clamp">clamp</option>
			</select>
			{(
				[
					["speed", speed, setSpeed],
					["offset", offset, setOffset],
				] as const
			).map(([key, value, set]) => (
				<div key={key}>
					<label htmlFor={`${id}-animation-add-${key}`}>animation.{key}</label>
					<Input
						id={`${id}-animation-add-${key}`}
						type="number"
						step="any"
						value={value}
						disabled={blocked}
						onChange={(event) => {
							if (!blocked) set(event.target.value);
						}}
					/>
				</div>
			))}
			<Button
				disabled={blocked || inputProps === undefined}
				onClick={() => {
					if (!blocked && inputProps !== undefined) onEdit({ inputProps });
				}}
			>
				Add animation
			</Button>
			<p className="text-muted-foreground">
				Confirm clip and playback values, then Add animation. This edits only
				the draft; use Recompile and apply.
			</p>
		</div>
	);
}

export function ProgrammaticAnimationCatalogChoices({
	id,
	state,
	clips,
	disabled,
	onEdit,
}: {
	id: string;
	state: BuildDraftSnapshot;
	clips: AnimationCatalogClip[];
	disabled: boolean;
	onEdit: (patch: { inputProps: string }) => void;
}) {
	const type = objectAnimationClipType({ state });
	const value = objectAnimationDraft({ text: state.inputProps })?.clip;
	const blocked = disabled || !!state.phase || state.conflict;
	const selected = clips.find(
		(clip) =>
			catalogClipSelectable(clip, clips, type) &&
			(type === "index" ? clip.index === value : clip.name === value),
	);
	return (
		<>
			<label htmlFor={`${id}-animation-catalog`}>Archived GLB clips</label>
			<select
				id={`${id}-animation-catalog`}
				value={selected ? String(selected.index) : ""}
				disabled={blocked || !type || !clips.length}
				className="bg-background text-foreground border-input focus-visible:ring-ring h-8 min-w-0 rounded-md border px-2 text-xs focus-visible:ring-2"
				onChange={(event) => {
					if (blocked || !event.target.value) return;
					const inputProps = selectAnimationCatalogClip(
						state,
						clips,
						Number(event.target.value),
					);
					if (inputProps !== undefined && inputProps !== state.inputProps)
						onEdit({ inputProps });
				}}
			>
				<option value="">
					{clips.length
						? "Choose a clip (manual value retained)"
						: "No animation clips"}
				</option>
				{clips.map((clip) => (
					<option
						key={clip.index}
						value={String(clip.index)}
						disabled={!catalogClipSelectable(clip, clips, type)}
					>
						{clip.index}: {clip.name || "(unnamed)"} ({clip.duration} s)
					</option>
				))}
			</select>
			<p className="text-muted-foreground">
				Selection edits only the draft. Use Recompile and apply. Unnamed or
				duplicate names require numeric clip input.
			</p>
		</>
	);
}
