import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const read = (relative) =>
	new TextDecoder("utf-8", { fatal: true }).decode(
		fs.readFileSync(path.join(root, relative)),
	);
const bootstrapSource = read("apps/cli/src/programmatic/html-media.ts");
const driverSource = read(
	"apps/cli/src/programmatic/engines/hyperframes-driver.ts",
);
const driverStart = driverSource.indexOf("String.raw`") + "String.raw`".length;
export const driver = driverSource
	.slice(driverStart, driverSource.indexOf("`;", driverStart))
	.replace("__ROCUT_FRAME_RATE__", "{numerator:100,denominator:1}");

export function fixture({
	autoPresent = false,
	supported = true,
	hasVideo = true,
	nativeAudio = false,
	authoredAudibleVideo = false,
} = {}) {
	const log = [];
	const callbacks = new Map();
	const listeners = new Map();
	let callbackSequence = 0;
	let presentationSequence = 0;
	let now = 0;
	let timelineTime = 0;
	class Video {
		_time = 0;
		readyState = 2;
		seeking = false;
		duration = 0.6;
		videoWidth = 64;
		videoHeight = 32;
		muted = true;
		autoplay = false;
		paused = true;
		src = "data:video/webm;base64,AQID";
		currentSrc = this.src;
		presentedMarker = 0;
		get currentTime() {
			return this._time;
		}
		set currentTime(value) {
			log.push(["assign", value]);
			this._time = value;
			this.seeking = true;
			if (autoPresent)
				queueMicrotask(() => {
					this.land();
					this.present(value);
				});
		}
		addEventListener(type, callback) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type).add(callback);
		}
		removeEventListener(type, callback) {
			listeners.get(type)?.delete(callback);
		}
		emit(type) {
			for (const callback of [...(listeners.get(type) ?? [])])
				callback({ type });
		}
		land() {
			this.seeking = false;
			this.emit("seeked");
		}
		present(mediaTime, overrides = {}) {
			this.presentedMarker = Math.round(mediaTime * 100);
			const pending = [...callbacks.values()];
			callbacks.clear();
			for (const cb of pending)
				cb(now, {
					mediaTime,
					presentationTime: now,
					presentedFrames: ++presentationSequence,
					...overrides,
				});
		}
		requestVideoFrameCallback(callback) {
			log.push(["observe", ++callbackSequence]);
			callbacks.set(callbackSequence, callback);
			return callbackSequence;
		}
		cancelVideoFrameCallback(id) {
			callbacks.delete(id);
		}
	}
	const video = new Video();
	if (authoredAudibleVideo) video.muted = false;
	const audioAssignments = [];
	const audioEvents = [];
	let audioTime = 0;
	const audio = { tagName: "AUDIO", duration: 0.6 };
	Object.defineProperty(audio, "currentTime", {
		get: () => audioTime,
		set: (value) => {
			audioTime = value;
			audioAssignments.push(value);
		},
	});
	if (!supported) video.requestVideoFrameCallback = undefined;
	const context = vm.createContext({
		console,
		setTimeout,
		clearTimeout,
		performance: { now: () => now },
		HTMLVideoElement: Video,
		frame: { videoLimits: { maxBytes: 100, maxDimension: 64, maxElements: 2 } },
		requestAnimationFrame(callback) {
			queueMicrotask(() => callback(now));
		},
		document: {
			body: { offsetHeight: 64 },
			fonts: [],
			addEventListener(_name, callback) {
				queueMicrotask(callback);
			},
			querySelectorAll: (selector) =>
				selector === "video" && hasVideo ? [video] : [],
			querySelector: (selector) =>
				selector === "[data-composition-id]"
					? { getAttribute: () => "root" }
					: null,
		},
		__playerReady: true,
		__renderReady: true,
		__timelines: { root: { totalTime() {} } },
		__player: {
			pause() {},
			renderSeek(time) {
				timelineTime = time;
				if (hasVideo) context.rocutMedia.nativeSeek(video, 0.18);
				if (nativeAudio) {
					context.site2(audio, 0.07999999999999);
					context.site3(audio, 0.12345599999999);
				}
			},
			isPlaying: () => false,
			getTime: () => timelineTime,
		},
		__hfWaitForSeekCompletion: async () => {},
		nativeAudioHandled: nativeAudio,
		nativeAudioBridge: {
			checkMedia: (ready) => audioEvents.push(["check", ready]),
		},
		rocutHyperframesAudio: nativeAudio
			? {
					enabled: true,
					prepare: async () => {
						audioEvents.push(["prepare"]);
						if (hasVideo) video.muted = true;
					},
					begin: (frame) => audioEvents.push(["begin", frame.time]),
				}
			: undefined,
	});
	vm.runInContext("globalThis.window = globalThis;", context);
	vm.runInContext(
		bootstrapSource.replace(
			"export const HTML_MEDIA_BOOTSTRAP =",
			"globalThis.bootstrap =",
		),
		context,
	);
	vm.runInContext(context.bootstrap, context);
	return {
		context,
		video,
		audio,
		audioAssignments,
		audioEvents,
		log,
		callbacks,
		listeners,
		begin: (options) =>
			context.rocutMedia.beginNativeFrame({
				videos: [video],
				deadline: 8000,
				...options,
			}),
		close: () => context.rocutMedia.endNativeFrame(),
		setNow: (value) => {
			now = value;
		},
		liveListeners: () =>
			[...listeners.values()].reduce((sum, values) => sum + values.size, 0),
	};
}

const compiler = read(
	"apps/cli/src/programmatic/engines/hyperframes-compiler-child.ts",
);
export function installSetterSites(fixture, compatible) {
	const patternLine = compiler
		.split("\n")
		.find((line) => line.includes("const decoderTime ="));
	const pattern = vm.runInNewContext(
		patternLine.trim().replace("const decoderTime =", "").replace(/;$/, ""),
	);
	const replacement = compatible
		? compiler.match(/\.replace\(\s*decoderTime,\s*'([^']*)'\s*\)/)[1]
		: "window.rocutMedia.nativeSeek($1,Math.round($2*1e6)/1e6)$3";
	const code =
		'function site2(v,t){try{v.currentTime=t}catch(e){f("runtime.media.site2",e)}}' +
		'function site3(v,t){try{v.currentTime=t}catch(e){f("runtime.media.site3",e)}}';
	assert.equal([...code.matchAll(pattern)].length, 2);
	const caught = [];
	fixture.context.f = (site, error) => caught.push([site, error.message]);
	vm.runInContext(code.replace(pattern, replacement), fixture.context);
	return caught;
}
