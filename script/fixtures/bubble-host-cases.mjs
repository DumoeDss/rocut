import { bubbleHostAnimated, bubbleHostChannel, bubbleHostId, bubbleHostSentinel,
	bubbleHostTargetIds, bubbleHostTrack } from "./bubble-host-contract.mjs";

export function bubbleHostClips({ staticShot, animatedShot, sixteenShot }) {
	return [...bubbleHostTargetIds, bubbleHostSentinel].map((id, index) => {
		const shot = structuredClone(index === 1 ? animatedShot : index === 3 ? sixteenShot : staticShot);
		if (id === "bubble-disabled") shot.effects[0].enabled = false;
		if (id === bubbleHostSentinel) { shot.effects = []; shot.animations = {}; }
		return { id, trackId: id === bubbleHostSentinel ? "bubble-sentinel" : bubbleHostTrack,
			startTime: index === 4 ? 0 : index * 240000, duration: 240000, trimStart: 0, trimEnd: 0,
			editing: { type: "graphic", name: id, definitionId: "programmatic",
				params: id === bubbleHostSentinel ? { opacity: 0.625 } : {},
				programmatic: shot.source, effects: shot.effects, animations: shot.animations } };
	});
}
export function bubbleHostInvalidCases(clips) {
	const cases = [];
	for (const clipId of bubbleHostTargetIds) {
		const original = clips.find((clip) => clip.id === clipId).editing;
		const last = original.effects[0].params.pointCount - 1;
		const add = (label, mutate) => {
			const editing = structuredClone(original); mutate(editing);
			cases.push({ label: `${clipId}:${label}`, clipId, editing });
		};
		for (const [label, mutate] of [
			["inactive-or-unknown-slot", (p) => { p[`point${last === 15 ? 16 : 15}X`] = 0.5; }],
			["missing-active-slot", (p) => { delete p[`point${last}Y`]; }],
			["duplicate-knot-time", (p) => { p[`point${last}Time`] = p[`point${last - 1}Time`]; }],
			["knot-after-duration", (p) => { p[`point${last}Time`] = 120001; }],
			["first-knot-nonzero", (p) => { p.point0Time = 1; }],
			["declared-slot-missing", (p) => { p.pointCount++; }],
			["fractional-trail", (p) => { p.trail = 2.5; }],
			["unsafe-activity-end", (p) => { p.startTicks = Number.MAX_SAFE_INTEGER; }],
			["computed-field", (p) => { p.phase = 0.5; }],
		]) add(label, (editing) => mutate(editing.effects[0].params));
		for (const key of Object.keys(bubbleHostAnimated)) add(`missing-fallback-${key}`, (editing) => {
			const value = editing.effects[0].params[key]; delete editing.effects[0].params[key];
			editing.animations[`effects.${bubbleHostId}.params.${key}`] = bubbleHostChannel(key, value);
		});
		for (const key of ["speed", "follow", "trail", "trailDurationTicks", "startTicks", "durationTicks",
			"pointCount", "point0Time", "point0X", "point0Y", "point1Time"])
			add(`static-channel-${key}`, (editing) => {
				editing.animations[`effects.${bubbleHostId}.params.${key}`] =
					bubbleHostChannel(key, editing.effects[0].params[key]);
			});
		for (const [label, mutate] of [
			["duplicate-time", (keys) => { keys[1].time = 0; }],
			["decreasing-time", (keys) => { keys[0].time = 240000; }],
			["negative-time", (keys) => { keys[0].time = -1; }],
			["fractional-time", (keys) => { keys[1].time = 1.5; }],
			["unsafe-time", (keys) => { keys[1].time = Number.MAX_SAFE_INTEGER + 1; }],
			["duplicate-id", (keys) => { keys[1].id = keys[0].id; }],
			["invalid-segment", (keys) => { keys[0].segmentToNext = "unsupported"; }],
		]) add(`animation-${label}`, (editing) => {
			const channel = { keys: [0, 180000].map((time, index) => ({ id: `r${index}`, time,
				value: 0.05, segmentToNext: "linear", tangentMode: "auto" })) };
			mutate(channel.keys); editing.animations[`effects.${bubbleHostId}.params.radius`] = channel;
		});
	}
	return cases;
}
export function bubbleHostAtomicBatch({ invalid, sentinel }) {
	return [{ kind: "update-clip", clipId: sentinel.id,
		patch: { editing: { ...structuredClone(sentinel.editing), name: `Must roll back: ${invalid.label}` } } },
	{ kind: "update-clip", clipId: invalid.clipId, patch: { editing: invalid.editing } }];
}
