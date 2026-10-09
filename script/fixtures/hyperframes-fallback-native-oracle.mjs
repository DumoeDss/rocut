/**
 * Actual core 0.8.139 fallback/route control-function regression evidence.
 * Node adapters provide DOM/state only; no browser playback, PCM, or whole-
 * history proof is claimed. The conditional invariant test is a regression
 * of a stated proof's premises, NOT evidence that arbitrary authors obey them.
 *
 * node script/fixtures/hyperframes-fallback-native-oracle.mjs <toolchain>
 * Writes a generated report below the configured TEMP/TMP, never a shared app.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw Error("Pass an existing fixed private toolchain");
const core = join(root, "node_modules/@hyperframes/core");
const text = async (path) =>
	new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
const pkg = JSON.parse(await text(join(core, "package.json")));
assert.equal(pkg.name, "@hyperframes/core");
assert.equal(pkg.version, "0.8.139");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const paths = {
	media: "runtime/media.js",
	route: "runtime/webAudioRoute.js",
	envelope: "runtime/mediaVolumeEnvelope.js",
	gain: "audioGain.js",
	fade: "audioFade.js",
	dom: "runtime/domRealm.js",
};
const native = {},
	hashes = {};
for (const [key, path] of Object.entries(paths)) {
	const absolute = join(core, "dist", path);
	hashes[path] = digest(await text(absolute));
	native[key] = await import(pathToFileURL(absolute).href);
}
const runtime = await text(join(core, "dist/hyperframe.runtime.iife.js"));
hashes["hyperframe.runtime.iife.js"] = digest(runtime);
const cut = (from, to) => {
	const start = runtime.indexOf(from);
	assert.ok(start >= 0, `Missing pinned source anchor: ${from}`);
	assert.equal(
		runtime.indexOf(from, start + 1),
		-1,
		`Ambiguous anchor: ${from}`,
	);
	const end = runtime.indexOf(to, start + from.length);
	assert.ok(end > start, `Missing end anchor: ${to}`);
	return runtime.slice(start, end);
};
const methods = [
	cut("routesElement(t){", "destroy(){"),
	cut("handleSourceEnded(t,n,r,i){", "async schedulePlayback("),
	cut("stopAll(){", "setVolume(t){"),
	cut("setElementVolume(t,n){", "setMuted(t){"),
];
const sourceKindPredicate = cut("function dr(e){", "var aR=");
const transportMethods = runInNewContext(
	`${sourceKindPredicate} ({${methods.join(",")}})`,
	{
		Je: native.gain.clampAudioGain,
		O: (_site, error) => {
			throw error;
		},
	},
	{ timeout: 1000 },
);
// The route predicate alone never promises a successful future source factory.
assert.ok(runtime.includes("this._activeSources.push(g),this._paused=!1,g"));
assert.ok(runtime.includes("this._activeSources.push(H),this._paused=!1,"));
const initialVolumeExpression = cut("Vc=c=>", ",Hi=()=>").slice(3);
const initialVolume = runInNewContext(
	`(${initialVolumeExpression})`,
	{},
	{ timeout: 1000 },
);
const makeTransport = () =>
	Object.assign(
		{
			_paused: true,
			_activeSources: [],
			_playGeneration: 0,
			_ctx: { destination: {} },
			rest() {},
		},
		transportMethods,
	);

function element(volume = 0.5) {
	return {
		nodeType: 1,
		namespaceURI: "http://www.w3.org/1999/xhtml",
		localName: "audio",
		tagName: "AUDIO",
		isConnected: true,
		ended: false,
		paused: true,
		volume,
		muted: false,
		currentTime: 0,
		playbackRate: 1,
		readyState: 4,
		HAVE_CURRENT_DATA: 2,
		dataset: { volume: "0.5" },
		currentSrc: "data:audio/wav;base64,AA==",
		baseURI: "https://fixture.invalid/",
		getAttribute(name) {
			return name === "src" ? this.currentSrc : null;
		},
		hasAttribute() {
			return false;
		},
		closest() {
			return null;
		},
		pause() {
			this.paused = true;
		},
		load() {},
	};
}
function source(el, overrides = {}) {
	return {
		el,
		start: 0,
		end: 1,
		duration: 1,
		mediaStart: 0,
		sourceDuration: 1,
		playbackRate: 1,
		volume: 0.5,
		loop: false,
		fades: { fadeIn: 0, fadeOut: 0 },
		...overrides,
	};
}
function sync(clip, time, { routed = false, volume = 1, transport } = {}) {
	let observed;
	native.media.syncRuntimeMedia({
		clips: [clip],
		timeSeconds: time,
		playing: false,
		playbackRate: 1,
		userVolume: volume,
		getCompositionDuration: () => 1,
		isWebAudioRouted: (el) =>
			transport ? transport.routesElement(el) : routed,
		onElementVolume(el, effective, author) {
			observed = { author, effective };
			transport?.setElementVolume(el, author);
		},
	});
	return observed;
}
const active = (el, kind = "buffer", priorVolume = el.volume) => ({
	el,
	sourceKind: kind,
	priorMuted: false,
	priorVolume,
	sourceNode: { stop() {}, disconnect() {}, connect() {} },
	gainNode: { gain: { value: 1 }, disconnect() {} },
});
const cases = [];
function check(name, callback) {
	cases.push({
		name,
		evidenceClass: "actual-native-control-functions",
		evidence: callback(),
	});
}

check("route-eligibility-is-not-active-route-or-lifetime", () => {
	const el = element(),
		transport = makeTransport();
	assert.equal(native.route.classifyWebAudioMediaRoute(el).kind, "web-audio");
	assert.equal(transport.routesElement(el), false);
	const first = active(el);
	transport._activeSources.push(first);
	transport._paused = false;
	assert.equal(transport.routesElement(el), true);
	transport.handleSourceEnded(first.sourceNode, first, el, false);
	assert.equal(transport.routesElement(el), false);
	transport._activeSources.push(active(el));
	transport._paused = false;
	assert.equal(transport.routesElement(el), true);
	transport.stopAll();
	assert.equal(transport.routesElement(el), false);
	assert.equal(native.route.classifyWebAudioMediaRoute(el).kind, "web-audio");
	return {
		eligibleThroughout: true,
		routeStates: [false, true, false, true, false],
		boundary:
			"Actual methods; source construction/decoding is not executed by this Node fixture",
	};
});

check(
	"unrouted-first-tick-and-external-write-are-not-static-declaration",
	() => {
		const el = element(0.25),
			clip = source(el);
		const first = sync(clip, 0).author;
		const unchanged = sync(clip, 0.1).author;
		el.volume = 0.75;
		const changed = sync(clip, 0.2).author;
		assert.deepEqual([first, unchanged, changed], [0.25, 0.5, 0.75]);
		return {
			identicalDeclaredVolume: clip.volume,
			actualAuthorGain: [first, unchanged, changed],
		};
	},
);

check("routed-fallback-is-constant-only-while-route-is-true", () => {
	const el = element(0.25),
		clip = source(el),
		transport = makeTransport();
	transport._activeSources.push(active(el, "media-element", 0.25));
	transport._paused = false;
	const routed = sync(clip, 0, { transport }).author;
	assert.equal(
		el.volume,
		1,
		"Actual native media-element callback restores its volume to unity",
	);
	transport.stopAll();
	assert.equal(el.volume, 0.25, "Actual native stop restores priorVolume");
	const afterStop = sync(clip, 0.1, { transport }).author;
	assert.deepEqual([routed, afterStop], [0.5, 0.25]);
	return {
		actualAuthorGain: [routed, afterStop],
		boundary: "A routed observation alone cannot certify later gain",
	};
});

check("boosted-baseline-does-not-immunize-later-unrouted-dom-writes", () => {
	const el = element(0.25),
		clip = source(el, { volume: 2 });
	const first = sync(clip, 0).author;
	el.volume = 0.5;
	const next = sync(clip, 0.1).author;
	assert.deepEqual([first, next], [2, 0.5]);
	return { actualAuthorGain: [first, next] };
});

check(
	"few-consistent-observations-do-not-prove-hidden-short-event-absence",
	() => {
		const el = element(),
			clip = source(el);
		const observations = [0, 0.1, 0.2].map((time) => sync(clip, time).author);
		el.volume = 0.125;
		const hidden = sync(clip, 0.201).author;
		const restored = sync(clip, 0.202).author;
		observations.push(sync(clip, 0.3).author);
		assert.deepEqual(observations, [0.5, 0.5, 0.5, 0.5]);
		assert.deepEqual([hidden, restored], [0.125, 0.5]);
		return {
			observations,
			unsampledAuthorGain: hidden,
			nextNativeBaseline: restored,
		};
	},
);

check(
	"missing-gsap-probe-envelope-does-not-prove-callback-cannot-write-volume",
	() => {
		const el = element(),
			clip = source(el),
			cache = new WeakMap();
		let seeks = 0;
		const timeline = {
			getChildren: () => [
				{
					targets: () => [el],
					vars: {
						onUpdate() {
							el.volume = 0.125;
						},
					},
				},
			],
			totalTime() {
				seeks++;
				el.volume = 0.125;
				return 0.201;
			},
		};
		native.envelope.probeAndCacheElementVolume(el, timeline, 1, cache);
		assert.equal(cache.has(el), false);
		assert.equal(
			seeks,
			0,
			"Pinned timelineCanMoveVolume excludes callback-only writes",
		);
		sync(clip, 0);
		timeline.totalTime(0.201);
		const actual = sync(clip, 0.201).author;
		assert.equal(actual, 0.125);
		return {
			normalizedEnvelopePresent: false,
			nativeProbeSeekCount: 0,
			callbackFallbackGain: actual,
		};
	},
);

check(
	"evicting-runtime-state-retains-dom-volume-and-changes-next-fallback",
	() => {
		const el = element(),
			clip = source(el, { fades: { fadeIn: 1, fadeOut: 0 } });
		assert.equal(sync(clip, 0.5).author, 0.25);
		native.media.evictMediaSyncState(el);
		const afterEviction = sync(clip, 0.6).author;
		assert.equal(afterEviction, 0.15);
		return {
			previousPostFadeGain: 0.25,
			afterEvictionPostFadeGain: afterEviction,
			expectedIfIncorrectlyAssumingBaseline: 0.3,
		};
	},
);

check(
	"conditional-data-only-canonical-invariant-regression-not-author-proof",
	() => {
		let evaluated = 0;
		for (const baseline of [0, 0.125, 0.5, 1, 2, 10]) {
			const el = element();
			el.dataset.volume = String(baseline);
			el.volume = initialVolume(el);
			const clip = source(el, {
				volume: baseline,
				fades: { fadeIn: 0.2, fadeOut: 0.2 },
			});
			for (const time of [0, 0.001, 0.07, 0.2, 0.333, 0.8, 0.95]) {
				const actual = sync(clip, time).author;
				const expected =
					native.gain.clampAudioGain(baseline) *
					native.fade.fadeGain(time, 1, clip.fades);
				assert.equal(actual, expected);
				evaluated++;
			}
		}
		return {
			evaluated,
			premises: [
				"native initialization from fixed data-volume",
				"fixed declarations and element identity",
				"no author/external volume writers",
				"unrouted paused canonical collection",
				"no mid-clip state eviction",
			],
			proof:
				"Initially D=clamp(E,0,1), so first fallback chooses E. Inductively only sync writes D and stores exactly the same C, so later fallback chooses E. Fades apply afterward.",
			boundary:
				"Examples test the conditional induction, not the absence of arbitrary authored JavaScript",
		};
	},
);

const directory = await mkdtemp(
	join(resolve(tmpdir()), "hyperframes-fallback-native-"),
);
const report = {
	oracle: "hyperframes-fallback-native-control",
	version: 1,
	nativeVersion: pkg.version,
	status: "passed-control-functions-only",
	sourceSha256: hashes,
	extractedRouteMethodsSha256: digest(methods.join("\n")),
	passed: cases.length,
	cases,
};
const reportPath = join(directory, "verification.json");
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", {
	encoding: "utf8",
	flag: "wx",
});
console.log(
	JSON.stringify({ passed: cases.length, reportPath, status: report.status }),
);
