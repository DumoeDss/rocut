import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { HYPERFRAMES_AUDIO_BOOTSTRAP } from "../programmatic/hyperframes-audio-bootstrap";

const src = "data:audio/wav;base64,AAAA";
class Media {
	id = "tone";
	tagName = "AUDIO";
	src = src;
	currentSrc = src;
	readyState = 1;
	duration = 1;
	muted = false;
	defaultMuted = false;
	paused = true;
	autoplay = false;
	error = null;
	attrs = new Map([["data-start", "0"]]);
	getAttribute(key: string) { return this.attrs.get(key) ?? null; }
	hasAttribute(key: string) { return this.attrs.has(key); }
	querySelector() { return null; }
	closest(key: string) { return key === "[data-fx-chain]" && this.hasAttribute("data-fx-chain") ? this : null; }
}

function fixture(elements: Media[], engine = "hyperframes", mode = "analysis", adapter = 1) {
	const context = {
		window: { __rocutHyperframesAudioAdapter: adapter } as { __rocutHyperframesAudioAdapter: number; rocutHyperframesAudio: {
			enabled: boolean; analysisOnly: boolean; checkMedia(ready?: boolean): void;
			prepare(): Promise<void>; begin(frame: { time: number }): void;
			observe(element: Media, observation: object): void; snapshot(): unknown[];
		} },
		HTMLMediaElement: Media, performance,
		document: { querySelector: () => null, querySelectorAll: () => elements },
		audioAnalysis: { engine, mode, sources: [{ src, id: "a".repeat(64) }], limits: { maxSeconds: 60, maxAssetsPerFrame: 4 } },
	};
	runInNewContext(HYPERFRAMES_AUDIO_BOOTSTRAP, context);
	return context.window.rocutHyperframesAudio;
}

test("native HyperFrames facts retain authored mute while browser playback stays silent", async () => {
	const media = new Media(), bridge = fixture([media]);
	bridge.checkMedia();
	expect(media.muted).toBe(true);
	await bridge.prepare();
	bridge.begin({ time: 0.25 });
	bridge.observe(media, { time: 0.25, sourceTime: 0.73, volume: 1.5 });
	expect(bridge.snapshot()).toEqual([{ id: "tone", resourceId: "a".repeat(64), type: "audio",
		time: 0.25, sourceTime: 0.73, volume: 1.5, muted: false }]);
	bridge.begin({ time: 0.5 });
	bridge.observe(media, { time: 0.25, sourceTime: 0.73, volume: 1.5 });
	expect(bridge.snapshot()).toEqual([]);
});

test("picture and other engines cannot masquerade as completed HyperFrames audio analysis", () => {
	const media = new Media();
	const picture = fixture([media], "hyperframes", "picture");
	expect(picture.enabled).toBe(true);
	expect(picture.analysisOnly).toBe(false);
	expect(() => picture.snapshot()).toThrow("analysis was not requested");
	const remotion = fixture([new Media()], "remotion");
	expect(remotion.enabled).toBe(false);
	expect(() => remotion.checkMedia()).toThrow("mixing integration");
});

test("adding native audio to an old picture-only bundle requires explicit recompilation", async () => {
	await expect(fixture([new Media()], "hyperframes", "analysis", 0).prepare()).rejects.toThrow("explicitly recompile");
});

test("native registration rejects unknown sources, duplicate IDs, playback and unsupported graph features", () => {
	for (const change of [
		(media: Media) => { media.currentSrc = "https://example.invalid/audio.wav"; },
		(media: Media) => { media.paused = false; },
		(media: Media) => { media.autoplay = true; },
		(media: Media) => { media.duration = Infinity; },
		(media: Media) => { media.id = ""; },
		(media: Media) => { media.attrs.delete("data-start"); },
		(media: Media) => { media.attrs.set("data-audio-group", "voice"); },
		(media: Media) => { media.attrs.set("data-hf-group-render-id", "voice"); },
		(media: Media) => { media.attrs.set("data-fx-chain", "[]"); },
		(media: Media) => { media.attrs.set("data-automation", '{"lanes":[{"target":"rate"}]}'); },
	]) {
		const media = new Media(); change(media);
		expect(() => fixture([media]).checkMedia()).toThrow();
	}
	expect(() => fixture([new Media(), new Media()]).checkMedia()).toThrow("Duplicate");
	const media = new Media(), bridge = fixture([media]);
	bridge.begin({ time: 0 });
	expect(() => bridge.observe(media, { time: 0 })).toThrow("Unregistered");
});

test("native graph admission cannot be bypassed by changing an already registered element", () => {
	for (const [key, value] of [
		["data-audio-group", "voice"], ["data-hf-group-render-id", "voice"],
		["data-fx-chain", "[]"], ["data-automation", '{"lanes":[{"target":"rate"}]}'],
	]) {
		const media = new Media(), bridge = fixture([media]);
		bridge.checkMedia();
		media.attrs.set(key, value);
		expect(() => bridge.checkMedia(true)).toThrow("native audio graph adapter");
	}
});

test("authored mute and silent-video declaration survive registration", () => {
	const audio = new Media(); audio.attrs.set("muted", "");
	const audioBridge = fixture([audio]); audioBridge.checkMedia(); audioBridge.begin({ time: 0 });
	audioBridge.observe(audio, { time: 0, volume: 1 });
	expect(audioBridge.snapshot()[0]).toMatchObject({ muted: true });
	const video = new Media(); video.tagName = "VIDEO"; video.attrs.set("data-has-audio", "false");
	const bridge = fixture([video]); bridge.checkMedia(); bridge.begin({ time: 0 });
	bridge.observe(video, { time: 0 });
	expect(bridge.snapshot()[0]).toMatchObject({ type: "video", muted: true });
});
