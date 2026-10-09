import assert from "node:assert/strict";
import type { HyperframesAudioGraphSnapshot } from "../../apps/cli/src/programmatic/hyperframes-audio-graph-types";

export interface CollectorRegistration {
	case: string;
	instanceId: string;
	authorId: string;
	authoredMuted: boolean;
	attributeMuted: boolean;
	scene: string | null;
	sceneAuthorId: string | null;
	sceneCompositionId: string | null;
	busId: string | null;
}

export interface CollectorReadiness {
	registrations: CollectorRegistration[];
	metadata: { instanceId: string; duration: number }[];
	runtimeReady: boolean;
	renderReady: boolean;
}

const near = (actual: number, expected: number, label: string) =>
	assert.ok(
		Math.abs(actual - expected) < 1e-8,
		`${label}: ${actual} != ${expected}`,
	);

export function assertCollectorReadiness(ready: CollectorReadiness) {
	assert.equal(ready.runtimeReady, true);
	assert.equal(ready.renderReady, true);
	assert.equal(ready.registrations.length, 9);
	assert.equal(ready.metadata.length, 9);
	for (const meta of ready.metadata)
		near(meta.duration, 0.16, "real WAV duration");
	assert.equal(new Set(ready.registrations.map((r) => r.instanceId)).size, 9);
	const grouped = ready.registrations.filter((r) => r.scene !== null);
	assert.equal(new Set(grouped.map((r) => r.busId)).size, 2);
	assert.deepEqual(
		[...new Set(grouped.map((r) => r.sceneAuthorId))],
		["scene"],
	);
	assert.deepEqual(
		[...new Set(grouped.map((r) => r.sceneCompositionId))],
		["scene"],
	);
	for (const id of ["track", "loop", "muted", "natural"])
		assert.equal(grouped.filter((r) => r.authorId === id).length, 2);
	for (const item of ready.registrations) {
		assert.equal(item.authoredMuted, item.case.endsWith("-muted"));
		assert.equal(item.attributeMuted, item.authoredMuted);
	}
}

export function assertCollectorSnapshot(
	snapshot: HyperframesAudioGraphSnapshot,
	ready: CollectorReadiness,
	time: number,
	resourceId: string,
) {
	assert.equal(snapshot.version, 1);
	assert.equal(snapshot.nativeVersion, "0.8.139");
	near(snapshot.time, time, "snapshot time");
	assert.equal(
		snapshot.tracks.length,
		9,
		"inactive/muted tracks must be retained",
	);
	assert.equal(snapshot.buses.length, 2);
	const allIds = [...snapshot.tracks, ...snapshot.buses].map(
		(item) => item.instanceId,
	);
	assert.equal(
		new Set(allIds).size,
		11,
		"track and bus identities share one unique namespace",
	);
	for (const registration of ready.registrations) {
		const track = snapshot.tracks.find(
			(item) => item.instanceId === registration.instanceId,
		);
		assert.ok(track, `missing ${registration.case}`);
		assert.equal(track.authorId, registration.authorId);
		assert.equal(track.resourceId, resourceId);
		assert.equal(track.type, "audio");
		assert.equal(track.authoredMuted, registration.authoredMuted);
		assert.equal(track.attributes.muted, registration.attributeMuted);
		assert.equal(track.attributes.groupRenderId, registration.busId);
		assert.equal(
			track.attributes.groupAuthorId,
			registration.scene ? "voice" : null,
		);
		assert.equal(track.ancestorHidden, registration.case === "hidden");
		near(
			track.observedAt,
			time,
			`${registration.case} fresh native observation`,
		);
		near(track.native.sourceDuration, 0.16, "native source duration");
		const kind = registration.case.split("-").at(-1);
		// Independent authored geometry: root + outer(.04) + scene(.04/.28) + media.
		const base = registration.scene === "first" ? 0.08 : 0.32;
		const start =
			kind === "hidden"
				? 0.6
				: base + (kind === "natural" ? 0.12 : kind === "muted" ? 0.04 : 0.02);
		const duration = kind === "loop" ? 0.2 : kind === "natural" ? 0.07 : 0.08;
		near(
			track.native.start,
			start,
			`${registration.case} native root-resolved start`,
		);
		near(
			track.native.duration,
			duration,
			`${registration.case} native duration`,
		);
		near(track.native.end, start + duration, `${registration.case} native end`);
		near(
			track.native.mediaStart,
			kind === "loop" ? 0.04 : kind === "trim" || kind === "natural" ? 0.02 : 0,
			"native trim",
		);
		assert.equal(track.native.loop, kind === "loop");
		assert.equal(track.native.playbackRate, kind === "natural" ? 2 : 1);
		assert.equal(track.native.rate, kind === "natural" ? 2 : 1);
		assert.equal(
			track.native.volume,
			kind === "trim"
				? 0.25
				: kind === "loop"
					? 0.125
					: kind === "muted"
						? 1
						: null,
		);
		assert.deepEqual(track.native.fades, { fadeIn: 0, fadeOut: 0 });
	}
	for (const scene of ["first", "second"]) {
		const busId = ready.registrations.find(
			(item) => item.scene === scene,
		)?.busId;
		const bus = snapshot.buses.find((item) => item.instanceId === busId);
		assert.ok(bus);
		assert.equal(bus.authorId, "voice");
		assert.equal(bus.hidden, false);
		assert.equal(bus.attributes.volume, scene === "first" ? "0.5" : "0.75");
	}
	assert.ok(
		snapshot.tracks.some(
			(track) => time < track.native.start || time >= track.native.end,
		),
	);
}
