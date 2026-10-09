import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { HYPERFRAMES_AUDIO_GRAPH_BOOTSTRAP } from "../programmatic/hyperframes-audio-graph-bootstrap";
import type {
	HyperframesAudioGraphBridge,
	HyperframesNativeClipFacts,
} from "../programmatic/hyperframes-audio-graph-types";

class Element {
	attrs = new Map<string, string>();
	hiddenAncestor = false;
	fxAncestor: Element | null = null;
	constructor(
		public tagName: string,
		instanceId: string,
		authorId = "same",
	) {
		this.attrs.set("data-hf-render-id", instanceId);
		this.attrs.set("id", authorId);
	}
	getAttribute(key: string) {
		return this.attrs.get(key) ?? null;
	}
	hasAttribute(key: string) {
		return this.attrs.has(key);
	}
	closest(key: string) {
		if (key === "[data-fx-chain]") return this.fxAncestor;
		return key === "[data-hidden]" &&
			(this.hiddenAncestor || this.hasAttribute("data-hidden"))
			? this
			: null;
	}
}
class Media extends Element {
	src = "data:audio/wav;base64,AAAA";
	currentSrc = this.src;
	muted = true; // The transport is already silent; this is NOT authored mute.
	querySelector() {
		return null;
	}
}
const asMedia = (element: Media) => element as unknown as HTMLMediaElement;
const native = (
	element: Media,
): HyperframesNativeClipFacts & { el: HTMLMediaElement } => ({
	el: asMedia(element),
	start: 12,
	end: 15,
	duration: 3,
	mediaStart: 7,
	sourceDuration: 20,
	playbackRate: 2,
	rate: 2,
	loop: true,
	volume: null,
	fades: { fadeIn: 0.3, fadeOut: 0.2 },
	volumeKeyframes: [{ time: 0.1, volume: 1.5 }],
});
function fixture(media: Media[], buses: Element[] = []) {
	const window = {} as {
		rocutHyperframesAudioGraph: HyperframesAudioGraphBridge;
	};
	runInNewContext(HYPERFRAMES_AUDIO_GRAPH_BOOTSTRAP, {
		window,
		HTMLMediaElement: Media,
		document: {
			querySelectorAll: (selector: string) =>
				selector === "audio,video" ? media : buses,
		},
	});
	return window.rocutHyperframesAudioGraph;
}
function register(
	bridge: HyperframesAudioGraphBridge,
	media: Media,
	authoredMuted = false,
) {
	bridge.registerMedia(asMedia(media), {
		resourceId: "admitted-resource",
		authoredMuted,
	});
}

test("compiled instance identity preserves duplicate author IDs, inactive and muted tracks", () => {
	const a = new Media("AUDIO", "voice"),
		b = new Media("VIDEO", "voice__hf2");
	const busA = new Element("HF-AUDIO-GROUP", "bus"),
		busB = new Element("HF-AUDIO-GROUP", "bus__hf2");
	a.attrs.set("data-hf-group-render-id", "bus");
	b.attrs.set("data-hf-group-render-id", "bus__hf2");
	a.attrs.set("data-audio-group", "same");
	b.attrs.set("data-audio-group", "same");
	a.fxAncestor = busA;
	busA.attrs.set("data-fx-chain", "ancestor-only");
	b.attrs.set("muted", "");
	b.attrs.set("data-has-audio", "false");
	busB.attrs.set("data-hidden", "");
	busB.attrs.set("data-volume", "not-normalized");
	const bridge = fixture([a, b], [busA, busB]);
	register(bridge, a);
	register(bridge, b, true);
	bridge.begin({ time: 0 }); // Both native clips start at 12, so neither is active.
	bridge.collectTrack(asMedia(a), native(a), 0);
	bridge.collectTrack(asMedia(b), native(b), 0);
	const snapshot = bridge.snapshot();
	expect(snapshot.tracks.map((track) => track.instanceId)).toEqual([
		"voice",
		"voice__hf2",
	]);
	expect(snapshot.tracks.map((track) => track.authorId)).toEqual([
		"same",
		"same",
	]);
	expect(snapshot.tracks[0]).toMatchObject({
		authoredMuted: false,
		observedAt: 0,
		native: { start: 12, mediaStart: 7, volume: null },
		attributes: { fxChain: null },
	});
	expect(snapshot.tracks[1]).toMatchObject({
		authoredMuted: true,
		attributes: { groupRenderId: "bus__hf2", muted: true, hasAudio: "false" },
	});
	expect(snapshot.buses[1]).toMatchObject({
		hidden: true,
		attributes: { volume: "not-normalized" },
	});
	expect(JSON.stringify(snapshot)).not.toContain('"el"');
	expect(Object.isFrozen(bridge)).toBe(true);
});

test("raw own-element FX and automation are not inherited, parsed or normalized", () => {
	const media = new Media("AUDIO", "track");
	media.hiddenAncestor = true;
	media.attrs.set("data-fx-chain", "invalid-json-for-rust");
	media.attrs.set("data-automation", '{"lanes":[{"target":"rate"}]}');
	const bridge = fixture([media]);
	register(bridge, media);
	bridge.begin({ time: 0.4 });
	const clip = native(media);
	clip.rate = {
		target: "rate",
		points: [
			{ t: 0, v: 1 },
			{ t: 1, v: 4 },
		],
	};
	bridge.collectTrack(asMedia(media), clip, 0.4);
	clip.fades.fadeIn = 99;
	clip.rate.points[0].v = 99;
	const track = bridge.snapshot().tracks[0];
	expect(track.attributes.fxChain).toBe("invalid-json-for-rust");
	expect(track.attributes.automation).toBe('{"lanes":[{"target":"rate"}]}');
	expect(track.ancestorHidden).toBe(true);
	expect(track.native.fades.fadeIn).toBe(0.3);
	expect(track.native.rate).toEqual({
		target: "rate",
		points: [
			{ t: 0, v: 1 },
			{ t: 1, v: 4 },
		],
	});
	track.native.fades.fadeOut = 99;
	expect(bridge.snapshot().tracks[0].native.fades.fadeOut).toBe(0.2);
	media.attrs.set("data-fx-chain", "changed-after-native-sync");
	expect(() => bridge.snapshot()).toThrow("attributes changed");
});

test("missing stamps and repeated instance IDs are explicit errors, not positional IDs", () => {
	const unstamped = new Media("AUDIO", "unused");
	unstamped.attrs.delete("data-hf-render-id");
	expect(() => register(fixture([unstamped]), unstamped)).toThrow("recompile");
	const a = new Media("AUDIO", "duplicate"),
		b = new Media("AUDIO", "duplicate");
	const bridge = fixture([a, b]);
	register(bridge, a);
	register(bridge, b);
	bridge.begin({ time: 0 });
	bridge.collectTrack(asMedia(a), native(a), 0);
	bridge.collectTrack(asMedia(b), native(b), 0);
	expect(() => bridge.snapshot()).toThrow("Duplicate");
	const media = new Media("AUDIO", "cross-kind"),
		bus = new Element("HF-AUDIO-GROUP", "cross-kind");
	const other = fixture([media], [bus]);
	register(other, media);
	other.begin({ time: 0 });
	other.collectTrack(asMedia(media), native(media), 0);
	expect(() => other.snapshot()).toThrow("Duplicate");
});

test("missing native facts cannot be replaced by authored DOM timing or stale frames", () => {
	const media = new Media("AUDIO", "track");
	media.attrs.set("data-start", "some-other-clip");
	const bridge = fixture([media]);
	register(bridge, media);
	bridge.collectTrack(asMedia(media), native(media), 0); // Pre-begin runtime polls are inert.
	bridge.begin({ time: 0 });
	expect(() => bridge.snapshot()).toThrow("Missing");
	const fresh = fixture([media]);
	register(fresh, media);
	fresh.begin({ time: 0 });
	expect(() =>
		fresh.collectTrack(
			asMedia(media),
			{ ...native(media), duration: Infinity },
			0,
		),
	).toThrow("finite native");
	expect(() => fresh.begin({ time: 0 })).toThrow("finite native"); // Failure remains latched.
	const next = fixture([media]);
	register(next, media);
	next.begin({ time: 0 });
	next.collectTrack(asMedia(media), native(media), 0);
	next.begin({ time: 1 });
	expect(() => next.snapshot()).toThrow("Missing");
});

test("unregistered media, mismatched native objects and post-admission source changes fail", () => {
	const media = new Media("AUDIO", "track");
	const unregistered = fixture([media]);
	unregistered.begin({ time: 0 });
	expect(() =>
		unregistered.collectTrack(asMedia(media), native(media), 0),
	).toThrow("Unregistered");
	const mismatch = fixture([media]);
	register(mismatch, media);
	mismatch.begin({ time: 0 });
	expect(() =>
		mismatch.collectTrack(
			asMedia(media),
			native(new Media("AUDIO", "other")),
			0,
		),
	).toThrow("mismatch");
	const changed = fixture([media]);
	register(changed, media);
	changed.begin({ time: 0 });
	media.currentSrc = "changed";
	expect(() => changed.collectTrack(asMedia(media), native(media), 0)).toThrow(
		"source changed",
	);
});

test("bus-to-bus membership is rejected; unresolved track membership remains raw for Rust", () => {
	const media = new Media("AUDIO", "track");
	media.attrs.set("data-audio-group", "missing");
	const bridge = fixture([media]);
	register(bridge, media);
	bridge.begin({ time: 0 });
	bridge.collectTrack(asMedia(media), native(media), 0);
	expect(bridge.snapshot()).toMatchObject({
		buses: [],
		tracks: [{ attributes: { groupAuthorId: "missing", groupRenderId: null } }],
	});
	const bus = new Element("HF-AUDIO-GROUP", "bus");
	bus.attrs.set("data-audio-group", "parent");
	const nested = fixture([media], [bus]);
	register(nested, media);
	nested.begin({ time: 0 });
	nested.collectTrack(asMedia(media), native(media), 0);
	expect(() => nested.snapshot()).toThrow("track-to-bus");
});

test("registered instance stamps cannot change between collection frames", () => {
	for (const operation of ["register", "collect", "snapshot"]) {
		const media = new Media("AUDIO", "original"),
			bridge = fixture([media]);
		register(bridge, media);
		bridge.begin({ time: 0 });
		bridge.collectTrack(asMedia(media), native(media), 0);
		bridge.snapshot();
		bridge.begin({ time: 1 });
		if (operation === "snapshot")
			bridge.collectTrack(asMedia(media), native(media), 1);
		media.attrs.set("data-hf-render-id", "changed");
		const action =
			operation === "register"
				? () => register(bridge, media)
				: operation === "collect"
					? () => bridge.collectTrack(asMedia(media), native(media), 1)
					: () => bridge.snapshot();
		expect(action).toThrow(/identity/);
	}
});
