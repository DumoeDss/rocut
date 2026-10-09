import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { HYPERFRAMES_AUDIO_GRAPH_BOOTSTRAP } from "../programmatic/hyperframes-audio-graph-bootstrap";
import type {
	HyperframesAudioGraphBridge,
	HyperframesNativeClipFacts,
	HyperframesResolvedAuthorGainFacts,
} from "../programmatic/hyperframes-audio-graph-types";

class Media {
	src = "data:audio/wav;base64,AAAA";
	currentSrc = this.src;
	tagName = "AUDIO";
	getAttribute(key: string) {
		return key === "data-hf-render-id" ? "track" : null;
	}
	hasAttribute() {
		return false;
	}
	closest() {
		return null;
	}
}
function fixture() {
	const media = new Media() as unknown as HTMLMediaElement;
	const window = {} as {
		rocutHyperframesAudioGraph: HyperframesAudioGraphBridge;
	};
	runInNewContext(HYPERFRAMES_AUDIO_GRAPH_BOOTSTRAP, {
		window,
		HTMLMediaElement: Media,
		document: {
			querySelectorAll: (selector: string) =>
				selector === "audio,video" ? [media] : [],
		},
	});
	const bridge = window.rocutHyperframesAudioGraph;
	bridge.registerMedia(media, { resourceId: "admitted", authoredMuted: false });
	const clip: HyperframesNativeClipFacts & { el: HTMLMediaElement } = {
		el: media,
		start: 1,
		end: 2,
		duration: 1,
		mediaStart: 0.2,
		sourceDuration: 2,
		playbackRate: 1,
		rate: 1,
		loop: false,
		volume: null,
		fades: { fadeIn: 0.1, fadeOut: 0.2 },
	};
	return { bridge, media, clip };
}
const fallback = (gain: number): HyperframesResolvedAuthorGainFacts => ({
	gainBeforeFades: gain,
	source: "fallback",
	points: null,
	fades: { fadeIn: 0.1, fadeOut: 0.2 },
	fallback: {
		routed: false,
		previousRuntimeVolume: null,
		currentElementVolume: gain,
		baselineGain: 1,
	},
});

test("resolved author gain is explicitly unobserved until the matching active native sync", () => {
	const { bridge, media, clip } = fixture();
	bridge.collectResolvedAuthorGain(media, clip, 0, fallback(0.25)); // Startup is inert.
	bridge.begin({ time: 0 });
	bridge.collectTrack(media, clip, 0);
	expect(bridge.snapshot().tracks[0].resolvedAuthorGain).toEqual({
		state: "unobserved",
	});
	bridge.begin({ time: 1.2 });
	bridge.collectTrack(media, clip, 1.2);
	bridge.collectResolvedAuthorGain(media, clip, 1.2, fallback(0.25));
	expect(bridge.snapshot().tracks[0]).toMatchObject({
		native: { volume: null },
		resolvedAuthorGain: {
			state: "observed",
			observedAt: 1.2,
			gainBeforeFades: 0.25,
			source: "fallback",
			fallback: {
				currentElementVolume: 0.25,
				baselineGain: 1,
				previousRuntimeVolume: null,
				routed: false,
			},
		},
	});
	bridge.collectTrack(media, clip, 1.2); // Another native pass must not keep old gain facts.
	expect(bridge.snapshot().tracks[0].resolvedAuthorGain).toEqual({
		state: "unobserved",
	});
	bridge.begin({ time: 0.5 });
	bridge.collectTrack(media, clip, 0.5);
	expect(bridge.snapshot().tracks[0].resolvedAuthorGain).toEqual({
		state: "unobserved",
	});
});

test("native normalized gain envelopes are copied without interpreting points, fades or clip.volume", () => {
	for (const source of ["normalized-volume-lane", "normalized-GSAP"] as const) {
		const { bridge, media, clip } = fixture();
		bridge.begin({ time: 1.2 });
		bridge.collectTrack(media, clip, 1.2);
		const gain: HyperframesResolvedAuthorGainFacts = {
			gainBeforeFades: 2.5,
			source,
			points: [
				{ t: 0, v: 0.25, curve: 0.5, viaX: 0.2, viaY: 1.5 },
				{ t: 1, v: 3 },
			],
			fades: { fadeIn: 0.3, fadeOut: 0.4 },
			fallback: null,
		};
		bridge.collectResolvedAuthorGain(media, clip, 1.2, gain);
		gain.points![0].v = 99;
		gain.fades.fadeIn = 99;
		const observed = bridge.snapshot().tracks[0].resolvedAuthorGain;
		expect(observed).toMatchObject({
			state: "observed",
			source,
			gainBeforeFades: 2.5,
			points: [
				{ t: 0, v: 0.25, curve: 0.5, viaX: 0.2, viaY: 1.5 },
				{ t: 1, v: 3 },
			],
			fades: { fadeIn: 0.3, fadeOut: 0.4 },
		});
		if (observed.state === "observed") observed.gainBeforeFades = 99;
		expect(bridge.snapshot().tracks[0].resolvedAuthorGain).toMatchObject({
			gainBeforeFades: 2.5,
		});
	}
});

test("resolved gain refuses missing native clips, mismatched clocks and non-finite facts", () => {
	for (const problem of [
		"missing",
		"clip",
		"time",
		"gain",
		"points",
		"history",
	]) {
		const { bridge, media, clip } = fixture();
		bridge.begin({ time: 1.2 });
		if (problem !== "missing") bridge.collectTrack(media, clip, 1.2);
		const gain = fallback(0.75);
		if (problem === "gain") gain.gainBeforeFades = NaN;
		if (problem === "points") gain.points = [];
		if (problem === "history") gain.fallback!.previousRuntimeVolume = Infinity;
		expect(() =>
			bridge.collectResolvedAuthorGain(
				media,
				problem === "clip" ? { ...clip } : clip,
				problem === "time" ? 1.3 : 1.2,
				gain,
			),
		).toThrow();
	}
});
