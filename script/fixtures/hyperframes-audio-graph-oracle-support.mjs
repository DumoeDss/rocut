/** Recording adapters only: these do not implement Web Audio rendering. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createContext, runInContext } from "node:vm";

export const sha256 = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");

export function near(actual, expected, tolerance = 1e-12) {
	assert.ok(Number.isFinite(actual), `Non-finite result: ${actual}`);
	assert.ok(
		Math.abs(actual - expected) <= tolerance,
		`${actual} differs from ${expected} by more than ${tolerance}`,
	);
}

export class RecordedParam {
	value = 1;
	events = [];
	cancelScheduledValues(time) {
		this.events.push({ kind: "cancel", time });
	}
	setValueAtTime(value, time) {
		this.events.push({ kind: "set", value, time });
	}
	linearRampToValueAtTime(value, time) {
		this.events.push({ kind: "ramp", value, time });
	}
	setValueCurveAtTime(values, time, duration) {
		assert.equal(values.constructor.name, "Float32Array");
		this.events.push({ kind: "curve", values: [...values], time, duration });
	}
}

class RecordedNode {
	connections = [];
	constructor(kind) {
		this.kind = kind;
	}
	connect(target) {
		this.connections.push(target);
		return target;
	}
	disconnect() {
		this.connections.length = 0;
	}
}

export class RecordedWorkletNode extends RecordedNode {
	constructor(_context, processor, options) {
		super("worklet");
		this.processor = processor;
		this.options = options;
		this.messages = [];
		this.port = { postMessage: (message) => this.messages.push(message) };
	}
}

export function recordingContext() {
	const nodes = [];
	const make = (kind, params = []) => {
		const node = new RecordedNode(kind);
		for (const name of params) node[name] = new RecordedParam();
		nodes.push(node);
		return node;
	};
	return {
		sampleRate: 48000,
		currentTime: 0,
		nodes,
		createGain: () => make("gain", ["gain"]),
		createBiquadFilter: () => make("biquad", ["frequency", "Q", "gain"]),
		createDelay: () => make("delay", ["delayTime"]),
		createWaveShaper: () => make("waveshaper"),
		createConvolver: () => make("convolver"),
		createIIRFilter(feedforward, feedback) {
			return Object.assign(make("iir"), { feedforward, feedback });
		},
		createBuffer(channels, frames, sampleRate) {
			const planar = Array.from(
				{ length: channels },
				() => new Float32Array(frames),
			);
			return {
				length: frames,
				sampleRate,
				getChannelData: (channel) => planar[channel],
			};
		},
		createBufferSource() {
			const node = make("buffer-source", ["playbackRate"]);
			node.start = (when, offset) => {
				node.started = { when, offset };
			};
			node.stop = () => {
				node.stopped = true;
			};
			return node;
		},
	};
}

/**
 * Execute the pinned bundle's ACTUAL bus-volume helper, not a copied algorithm.
 * These exact source anchors deliberately fail if the pinned bundle changes.
 * Its minified imports are rebound to the same package's public ESM functions.
 * No DOM startup, authored script, browser or AudioContext is executed here.
 */
export function nativeBusScheduler(runtime, native) {
	const anchors = [
		"function Ra(e,t,n){let r=hb(Rb(e));r&&Ju([{param:t.gain}],r,so.scale,n)}",
		"function hb(e){return e.lanes.find(t=>t.target===Dn)??null}",
		"function Rb(e){return Tb(e,lr(e).chain)}",
		'function Tb(e,t){let n=(typeof e.getAttribute=="function"?e.getAttribute(kt):null)??"";if(!n)return Cb;try{return ef(lo(n),t)}catch{return Cb}}',
		'function lr(e){let t=(typeof e.getAttribute=="function"?e.getAttribute(bn):null)??"";if(!t)return{chain:wb,raw:""};try{return{chain:Yd(t),raw:t}}catch{return{chain:wb,raw:""}}}',
	];
	const source = anchors
		.map((anchor) => {
			const start = runtime.indexOf(anchor);
			assert.ok(
				start >= 0,
				`Pinned bus helper changed: ${anchor.slice(0, 30)}`,
			);
			assert.equal(runtime.indexOf(anchor, start + 1), -1);
			return runtime.slice(start, start + anchor.length);
		})
		.join("\n");
	const context = createContext({
		Ju: native.fxAutomation.scheduleParamLane,
		so: native.automation.VOLUME_RANGE,
		Dn: native.automation.VOLUME_TARGET,
		kt: native.automation.HF_AUDIO_AUTOMATION_ATTR,
		bn: native.fx.HF_AUDIO_FX_ATTR,
		Cb: { version: 1, lanes: [] },
		wb: { version: 1, nodes: [] },
		ef: native.automation.resolveAutomation,
		lo: native.automation.parseAutomation,
		Yd: native.fx.parseAudioFxChain,
	});
	runInContext(source, context, { timeout: 1000 });
	return {
		sourceSha256: sha256(source),
		schedule(element, param, timing) {
			Object.assign(context, { element, fader: { gain: param }, timing });
			runInContext("Ra(element, fader, timing)", context, { timeout: 1000 });
		},
	};
}

export function elementWithAutomation(lane, tagName = "AUDIO") {
	const raw = JSON.stringify({ version: 1, lanes: [lane] });
	return {
		tagName,
		isConnected: true,
		ended: false,
		paused: true,
		volume: 1,
		currentTime: 0,
		playbackRate: 1,
		readyState: 4,
		HAVE_CURRENT_DATA: 2,
		getAttribute: (name) => (name === "data-automation" ? raw : null),
		hasAttribute: () => false,
		closest: () => null,
	};
}

export function nativeTrackGain(native, lane, time, fades) {
	let actual;
	const el = elementWithAutomation(lane);
	const start = 3;
	// Nonzero trim and rate distinguish clip-local automation from source time.
	native.media.syncRuntimeMedia({
		clips: [
			{
				el,
				start,
				end: start + 1,
				duration: 1,
				mediaStart: 7,
				playbackRate: 2,
				volume: 1,
				loop: false,
				fades,
			},
		],
		timeSeconds: start + time,
		playing: false,
		playbackRate: 1,
		onElementVolume: (_element, _effective, author) => {
			actual = author;
		},
	});
	assert.equal(
		typeof actual,
		"number",
		"Native track callback did not execute",
	);
	native.media.evictMediaSyncState(el);
	return actual;
}
