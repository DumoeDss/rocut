import {
	blazeHostChannel,
	blazeHostFields,
	blazeHostId,
	blazeHostSentinel,
	blazeHostTargetIds,
	blazeHostTrack,
	type BlazeHostClip,
	type BlazeHostEditing,
	type BlazeHostShot,
} from "./blaze-host-contract";

export function blazeHostClips({
	staticShot,
	animatedShot,
}: {
	staticShot: BlazeHostShot;
	animatedShot: BlazeHostShot;
}): BlazeHostClip[] {
	const clips = [...blazeHostTargetIds, blazeHostSentinel].map((id, index) => {
		const shot = structuredClone(index === 1 ? animatedShot : staticShot);
		if (id === "blaze-disabled") shot.effects[0].enabled = false;
		if (id === blazeHostSentinel) shot.effects = [];
		return {
			id,
			trackId: id === blazeHostSentinel ? "blaze-sentinel" : blazeHostTrack,
			startTime: index === 3 ? 0 : index * 120000,
			duration: 120000,
			trimStart: 0,
			trimEnd: 0,
			editing: {
				type: "graphic" as const,
				name: id,
				definitionId: "programmatic" as const,
				params: id === blazeHostSentinel ? { opacity: 0.625 } : {},
				programmatic: shot.source,
				effects: shot.effects,
				animations: shot.animations,
			},
		};
	});
	return clips;
}

export type BlazeHostInvalid = {
	label: string;
	clipId: string;
	editing: BlazeHostEditing;
	issue: string;
};

export function blazeHostInvalidCases(clips: readonly BlazeHostClip[]) {
	const cases: BlazeHostInvalid[] = [];
	for (const clipId of blazeHostTargetIds) {
		const original = clips.find((clip) => clip.id === clipId)!.editing;
		const add = (
			label: string,
			issue: string,
			mutate: (editing: BlazeHostEditing) => void,
		) => {
			const editing = structuredClone(original);
			mutate(editing);
			cases.push({ label: `${clipId}:${label}`, clipId, editing, issue });
		};
		for (const [key, value] of [
			["phase", 0.5],
			["sparkCount", 12],
			["seed", 3.5],
			["speed", "0.5"],
			["refraction", null],
		] as const)
			add(
				`invalid-${key}`,
				value === null ? `Invalid clip ${clipId}` : key,
				(editing) => {
					editing.effects[0].params[key] = value;
				},
			);
		for (const [key, min, max, step, , keyframable] of blazeHostFields) {
			for (const [label, value] of [
				["below", min - step],
				["above", max + step],
			] as const) {
				add(`${key}-${label}`, key, (editing) => {
					editing.effects[0].params[key] = value;
				});
				if (keyframable)
					add(`${key}-animation-${label}`, key, (editing) => {
						editing.animations[`effects.${blazeHostId}.params.${key}`] =
							blazeHostChannel(key, value);
					});
			}
			if (keyframable)
				add(`${key}-missing-fallback`, key, (editing) => {
					delete editing.effects[0].params[key];
					editing.animations[`effects.${blazeHostId}.params.${key}`] =
						blazeHostChannel(key, min);
				});
			else
				add(`${key}-static-channel`, key, (editing) => {
					editing.animations[`effects.${blazeHostId}.params.${key}`] =
						blazeHostChannel(key, min);
				});
		}
	}
	return cases;
}

export function blazeHostAtomicBatch({
	invalid,
	sentinel,
}: {
	invalid: BlazeHostInvalid;
	sentinel: BlazeHostClip;
}) {
	return [
		{
			kind: "update-clip",
			clipId: sentinel.id,
			patch: {
				editing: {
					...sentinel.editing,
					name: `Must roll back: ${invalid.label}`,
				},
			},
		},
		{
			kind: "update-clip",
			clipId: invalid.clipId,
			patch: { editing: invalid.editing },
		},
	];
}
