import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	HyperframesAudioGraphSnapshot,
	HyperframesResolvedAuthorGain,
} from "../../apps/cli/src/programmatic/hyperframes-audio-graph-types";
import type { CollectorReadiness } from "./hyperframes-audio-graph-collector-assert";
import {
	COLLECTOR_ROUTED_GAIN,
	collectorSeek,
} from "./hyperframes-audio-graph-collector-page";

export type CollectorEvaluate = <T>(expression: string) => Promise<T>;
const near = (actual: number, expected: number) =>
	assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
function observed(snapshot: HyperframesAudioGraphSnapshot, id: string) {
	const track = snapshot.tracks.find((item) => item.authorId === id);
	assert.ok(track, id);
	const gain: HyperframesResolvedAuthorGain = track.resolvedAuthorGain;
	assert.equal(gain.state, "observed", id);
	if (gain.state !== "observed") throw Error(`Unobserved active ${id}`);
	near(gain.observedAt, snapshot.time);
	near(track.observedAt, snapshot.time);
	return { track, gain };
}

export async function probeCollectorGains(
	evaluate: CollectorEvaluate,
	staging: string,
	readiness: CollectorReadiness,
	playGesture?: () => Promise<void>,
) {
	assert.equal(readiness.registrations.length, 5);
	const phases: { time: number; volumes: Record<string, number> }[] = [
		{
			time: 0.12,
			volumes: { "dom-low": 0.25, "dom-high": 0.75, routed: 0.25 },
		},
		{ time: 0.16, volumes: {} },
		{
			time: 0.12,
			volumes: { "dom-low": 0.75, "dom-high": 0.25, routed: 0.75 },
		},
		{ time: 0, volumes: {} },
	];
	for (const [index, phase] of phases.entries()) {
		const snapshot = await evaluate<HyperframesAudioGraphSnapshot>(
			collectorSeek(phase.time, phase.volumes),
		);
		await writeFile(
			join(staging, `gain-snapshot-${index}.json`),
			JSON.stringify(snapshot, null, 2),
			{ encoding: "utf8", flag: "wx" },
		);
		assert.equal(snapshot.tracks.length, 5);
		for (const id of ["dom-low", "dom-high", "routed"]) {
			const { track, gain } = observed(snapshot, id);
			assert.equal(track.native.volume, null, "DOM .volume is not clip.volume");
			assert.equal(gain.source, "fallback");
			assert.equal(gain.points, null);
			assert.ok(gain.fallback);
			near(gain.fallback.baselineGain, 1);
			assert.equal(
				gain.fallback.routed,
				false,
				"native renderSeek stops Web Audio routing",
			);
			if (index === 1) {
				near(gain.gainBeforeFades, 1);
				near(
					gain.fallback.previousRuntimeVolume!,
					id === "dom-high" ? 0.75 : 0.25,
				);
			} else if (index === 0 || index === 2)
				near(gain.gainBeforeFades, phase.volumes[id]);
		}
		if (phase.time === 0) {
			for (const id of ["lane", "gsap-volume"])
				assert.deepEqual(
					snapshot.tracks.find((track) => track.authorId === id)
						?.resolvedAuthorGain,
					{ state: "unobserved" },
				);
			continue;
		}
		const lane = observed(snapshot, "lane").gain;
		assert.equal(lane.source, "normalized-volume-lane");
		assert.equal(lane.fallback, null);
		assert.deepEqual(lane.points, [
			{ t: 0, v: 0.25, curve: 1, viaX: 0.25, viaY: 0.5 },
			{ t: 0.2, v: 0.75 },
		]);
		assert.deepEqual(lane.fades, { fadeIn: 0.1, fadeOut: 0.2 });
		const gsap = observed(snapshot, "gsap-volume").gain;
		assert.equal(gsap.source, "normalized-GSAP");
		assert.equal(gsap.fallback, null);
		assert.ok(gsap.points && gsap.points.length > 2);
		near(gsap.points[0].t, 0);
		near(gsap.points[0].v, 0.25);
		near(gsap.points.at(-1)!.t, 0.4);
		near(gsap.points.at(-1)!.v, 0.75);
		near(gsap.gainBeforeFades, 0.25 + (phase.time - 0.08) * 2.5);
		assert.deepEqual(gsap.fades, { fadeIn: 0.1, fadeOut: 0 });
	}
	const result = {
		seeks: phases.map((phase) => phase.time),
		tracksPerSeek: 5,
		busesPerSeek: 1,
		observations: phases.length,
	};
	if (!playGesture) return { ...result, routedPreview: "not-exercised" };
	await evaluate<HyperframesAudioGraphSnapshot>(collectorSeek(0.12));
	await evaluate(
		"window.rocutHyperframesAudioGraph.begin({time:window.__player.getTime()})",
	);
	await playGesture();
	const routed = await evaluate<HyperframesAudioGraphSnapshot>(
		COLLECTOR_ROUTED_GAIN,
	);
	await writeFile(
		join(staging, "gain-routed-preview.json"),
		JSON.stringify(routed, null, 2),
		{ encoding: "utf8", flag: "wx" },
	);
	const route = routed.tracks.find((track) => track.authorId === "routed")!;
	const gain = route.resolvedAuthorGain;
	assert.equal(gain.state, "observed");
	if (gain.state !== "observed")
		throw Error("Native routed gain is unobserved");
	assert.equal(gain.source, "fallback");
	assert.equal(gain.fallback?.routed, true);
	near(gain.gainBeforeFades, 1);
	near(gain.observedAt, route.observedAt);
	assert.ok(
		gain.observedAt >= routed.time && gain.observedAt < 0.72,
		"preview observation uses the advancing native clock",
	);
	return { ...result, routedPreview: "passed" };
}
