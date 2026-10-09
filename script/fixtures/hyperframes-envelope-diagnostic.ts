/** Real pinned compiler -> Chromium analyzer -> Rust schedule/mix PCM.
 * Run with the isolated-web-wasm-preload.mjs and explicit native decoder paths.
 * --oracle-only imports upstream math/GSAP without starting Chromium or WASM.
 * --case=<name[,name]> restricts integration work to authored fixtures.
 */
import { strict as assert } from "node:assert";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { nativeAudioWav } from "./native-audio-fixture";

const toolchain = process.argv[2];
if (!toolchain) throw Error("Usage: bun hyperframes-envelope-diagnostic.ts <isolated-toolchain> [--oracle-only] [--case=name]");
const coreRoot = join(resolve(toolchain), "node_modules/@hyperframes/core");
const corePackage = JSON.parse(await readFile(join(coreRoot, "package.json"), "utf8"));
assert.equal(corePackage.version, "0.8.139", "This diagnostic deliberately pins native gain semantics");
const nativeModule = (name: string) => import(pathToFileURL(join(coreRoot, "dist", name)).href);
const [automation, fades, audioGain, volumeEnvelope, gsapModule] = await Promise.all([
	nativeModule("audioAutomation.js"), nativeModule("audioFade.js"), nativeModule("audioGain.js"),
	nativeModule("runtime/mediaVolumeEnvelope.js"),
	import(pathToFileURL(join(resolve(toolchain), "node_modules/gsap/dist/gsap.js")).href),
]);
const gsap = gsapModule.gsap ?? gsapModule.default?.gsap ?? gsapModule.default;
assert.equal(typeof gsap.timeline, "function");

type Point = { t: number; v: number; curve?: number; viaX?: number; viaY?: number };
type Tween = { at: number; duration: number; volume: number; ease: string };
type Case = {
	name: string; baseGain: number; points?: Point[]; fadeIn?: number; fadeOut?: number;
	tween?: Tween; hidden?: boolean;
};
const frameRate = { numerator: 30000, denominator: 1001 };
const durationFrames = 12, sampleRate = 44100 as const;
const duration = durationFrames * frameRate.denominator / frameRate.numerator;
const sampleAt = (frame: number) => Math.floor(frame * sampleRate * frameRate.denominator / frameRate.numerator);
const frameTime = (frame: number) => frame * frameRate.denominator / frameRate.numerator;
const maxGain = audioGain.MAX_AUDIO_GAIN as number;
const cases: Case[] = [
	{ name: "linear", baseGain: 0.8, points: [{ t: 0.025, v: 0.1 }, { t: 0.32, v: 1.3 }] },
	{ name: "exponent", baseGain: 0.7, points: [
		{ t: 0, v: 0.15, curve: -0.5 }, { t: 0.2, v: 1.4, curve: 1 }, { t: duration, v: 0.2 },
	] },
	{ name: "via", baseGain: 0.4, points: [
		{ t: 0, v: 0.1, curve: 1, viaX: 0.25, viaY: 0.75 },
		{ t: 0.2, v: 1.5, curve: -0.5, viaX: 0.75, viaY: 0.25 }, { t: duration, v: 0.2 },
	] },
	{ name: "via-floor", baseGain: 0.5, points: [
		{ t: 0, v: 0, viaX: 0.5, viaY: 0.001 }, { t: duration, v: 1 },
	] },
	{ name: "via-ceiling-before-fades", baseGain: 0.5, fadeIn: 0.3, fadeOut: 0.3, points: [
		{ t: 0, v: maxGain, viaX: 0.5, viaY: 0.001 }, { t: duration, v: 0 },
	] },
	{ name: "oversized-fades", baseGain: 1.7, fadeIn: 0.7, fadeOut: 0.3 },
	{ name: "gsap-keyframes", baseGain: 1.5,
		tween: { at: 0.08, duration: 0.2, volume: 0.2, ease: "power2.inOut" }, fadeOut: 0.08 },
	{ name: "lane-overrides-gsap", baseGain: 1.8,
		tween: { at: 0.05, duration: 0.25, volume: 0.05, ease: "power2.in" },
		points: [{ t: 0, v: 0.25 }, { t: duration, v: 1.1 }], fadeIn: 0.03, fadeOut: 0.08 },
	{ name: "hidden-ancestor", baseGain: 1.5, hidden: true,
		points: [{ t: 0, v: 0.2 }, { t: duration, v: 1.3 }] },
];
const selectedNames = process.argv.find(argument => argument.startsWith("--case="))?.slice(7).split(",");
const selected = selectedNames ? cases.filter(item => selectedNames.includes(item.name)) : cases;
assert.ok(selected.length, `Unknown diagnostic cases ${selectedNames}`);
if (selectedNames) assert.equal(selected.length, new Set(selectedNames).size, "Unknown diagnostic case selection");

// Feed a plain-object target to the real GSAP implementation, and then invoke
// the real native volume probe. Minimal DOM timing accessors only locate this
// root-level clip; neither the probe sampling nor interpolation is duplicated.
function nativeGsapEnvelope(spec: Case): Array<{ time: number; volume: number }> {
	if (!spec.tween) return [];
	const attrs: Record<string, string> = {
		"data-start": "0", "data-duration": String(duration), "data-volume": String(spec.baseGain),
	};
	const element = {
		volume: spec.baseGain, dataset: { start: "0", duration: String(duration), volume: String(spec.baseGain) },
		getAttribute: (name: string) => attrs[name] ?? null,
		hasAttribute: (name: string) => name in attrs,
		closest: () => null,
	};
	const timeline = gsap.timeline({ paused: true }).to(element, {
		volume: spec.tween.volume, duration: spec.tween.duration, ease: spec.tween.ease,
	}, spec.tween.at);
	const globals = globalThis as unknown as Record<string, unknown>;
	const previous = ["window", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globals, key)] as const);
	try {
		Object.defineProperty(globals, "window", { configurable: true, value: { __timelines: {} } });
		Object.defineProperty(globals, "document", { configurable: true, value: {} });
		const raw = volumeEnvelope.probeElementVolumeKeyframes(element, (time: number) => {
			timeline.totalTime(time, true);
		}, duration, 60);
		assert.ok(raw?.length > 2, `The actual native probe did not detect ${spec.name}`);
		return volumeEnvelope.normaliseEnvelope(raw, 0, spec.baseGain);
	} finally {
		timeline.kill();
		gsap.ticker.sleep();
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globals, key, descriptor);
			else Reflect.deleteProperty(globals, key);
		}
	}
}

function oracleFor(spec: Case) {
	const lane = spec.points ? automation.parseAutomation(JSON.stringify({
		version: 1, lanes: [{ target: "volume", points: spec.points }],
	})).lanes.find((lane: { target: string }) => lane.target === "volume") : undefined;
	const gsapPoints = nativeGsapEnvelope(spec);
	const gain = (time: number): number => {
		if (spec.hidden) return 0;
		const resolved = lane ? automation.sampleAutomationLane(lane, time)
			: gsapPoints.length ? volumeEnvelope.interpolateVolumeGain(gsapPoints, time) : spec.baseGain;
		return audioGain.clampAudioGain(resolved) * fades.fadeGain(time, duration, {
			fadeIn: spec.fadeIn ?? 0, fadeOut: spec.fadeOut ?? 0,
		});
	};
	return { gain, lane, gsapPoints };
}

const references = new Map(selected.map(spec => [spec.name, oracleFor(spec)]));
for (const spec of selected) {
	const reference = references.get(spec.name)!;
	for (let i = 0; i < sampleAt(durationFrames); i++) {
		const gain = reference.gain(i / sampleRate);
		assert.ok(Number.isFinite(gain) && gain >= 0 && gain <= maxGain + 1e-12, `${spec.name}: invalid native gain at ${i}`);
	}
	if (spec.name === "via-floor") assert.equal(reference.gain(duration / 4), 0);
	if (spec.name === "via-ceiling-before-fades") assert.ok(Math.abs(reference.gain(duration / 4) - maxGain / 2) < 1e-12);
	if (spec.name === "lane-overrides-gsap") {
		const nativeG = volumeEnvelope.interpolateVolumeGain(reference.gsapPoints, 0.15);
		assert.ok(Math.abs(reference.gain(0.15) - nativeG) > 0.1, "Precedence fixture must distinguish GSAP from the explicit lane");
	}
}
console.log(JSON.stringify({ phase: "native-envelope-oracles", coreVersion: corePackage.version,
	cases: selected.map(spec => ({ name: spec.name, gsapPoints: references.get(spec.name)!.gsapPoints.length })),
	upstreamFunctions: ["sampleAutomationLane", "clampAudioGain", "fadeGain", "probeElementVolumeKeyframes", "normaliseEnvelope", "interpolateVolumeGain"] }));

if (!process.argv.includes("--oracle-only")) {
	const ffmpeg = process.env.ROCUT_TEST_FFMPEG, ffprobe = process.env.ROCUT_TEST_FFPROBE;
	if (!ffmpeg || !ffprobe) throw Error("Configure ROCUT_TEST_FFMPEG and ROCUT_TEST_FFPROBE");
	const [{ compileProgrammaticProject }, { FileProjectStore }, { renderHyperframesAudioRange },
		{ withHyperframesAudioAnalyzer }] = await Promise.all([
		import("../../apps/cli/src/programmatic/engines/compile-project"), import("../../apps/cli/src/file-store"),
		import("../../apps/cli/src/programmatic/hyperframes-audio-render"),
		import("../../apps/cli/src/programmatic/hyperframes-audio-analysis"),
	]);
	const require = createRequire(new URL("../../apps/vite-example/package.json", import.meta.url));
	const { chromium } = await import(pathToFileURL(require.resolve("@playwright/test")).href);
	const executable = chromium.executablePath(), decoder = { ffmpeg, ffprobe };
	const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, "rocut-hf-envelope-"));
	console.log(JSON.stringify({ phase: "native-envelope-start", root, sampleRate, frameRate, durationFrames }));
	let succeeded = false;
	try {
		const sourceDirectory = join(root, "author");
		await mkdir(sourceDirectory);
		await copyFile(join(resolve(toolchain), "node_modules/gsap/dist/gsap.min.js"), join(sourceDirectory, "gsap.js"));
		// Exact source-rate float WAV: pattern verifies decoder/source sample phase,
		// while its always-nonzero amplitude exposes gain differences at every sample.
		const wav = nativeAudioWav({ sampleRate, seconds: duration + 0.2,
			sample: (i, channel) => (0.125 + (i % 97) / 512) * (channel ? -0.5 : 1) });
		await writeFile(join(sourceDirectory, "tone.wav"), wav);
		const context = { store: new FileProjectStore({ root: join(root, "target"), schemaVersion: 1 }),
			projectId: "hyperframes-envelope-probe" };
		const signal = () => AbortSignal.timeout(180000);
		const ticksPerFrame = 120000 * frameRate.denominator / frameRate.numerator;
		const timing = (source: ProgrammaticSource, index: number) => ({ source, clipStart: 0,
			clipDuration: durationFrames * ticksPerFrame, trimStart: 0, timelineTime: index * ticksPerFrame });
		const render = (source: ProgrammaticSource, firstFrame: number, frameCount: number) => renderHyperframesAudioRange({
			source, firstFrame, frameCount, sampleRate, executable, decoder, resourceStore: context, signal: signal(),
		});
		let totalSamples = 0;
		for (const spec of selected) {
			const reference = references.get(spec.name)!;
			const entryFile = `${spec.name}.html`;
			const attr = spec.points ? ` data-automation='${JSON.stringify({ version: 1,
				lanes: [{ target: "volume", points: spec.points }] })}'` : "";
			const authoredTween = spec.tween ? `.to(document.getElementById("tone"),${JSON.stringify({
				volume: spec.tween.volume, duration: spec.tween.duration, ease: spec.tween.ease,
			})},${spec.tween.at})` : "";
			const html = `<!doctype html><html><head><script src="gsap.js"></script></head><body>
<div id="root" data-composition-id="root" data-start="0" data-duration="${duration}" data-width="64" data-height="64">
<div${spec.hidden ? " data-hidden" : ""}><audio id="tone" src="tone.wav" data-start="0" data-duration="${duration}" data-track-index="0"
 data-volume="${spec.baseGain}" data-fade-in="${spec.fadeIn ?? 0}" data-fade-out="${spec.fadeOut ?? 0}"${attr}></audio></div>
</div><script>window.__timelines=window.__timelines||{};window.__timelines.root=gsap.timeline({paused:true})${authoredTween};</script>
</body></html>`;
			await writeFile(join(sourceDirectory, entryFile), html, "utf8");
			const source = (await compileProgrammaticProject({ action: "compile", input: {
				version: 1, engine: "hyperframes", sourceDirectory, entryFile, files: [entryFile, "gsap.js", "tone.wav"],
				width: 64, height: 64, frameRate, durationFrames, seed: 7, audio: { version: 1, mode: "native" },
			}, toolchainDirectory: resolve(toolchain), context, signal: signal(), enqueue: task => task() })).source;
			// This admission assertion is supplementary. Success below requires all
			// output PCM samples, not just frame observations, to match upstream.
			await withHyperframesAudioAnalyzer({ executable, request: timing(source, 4), resourceStore: context,
				signal: signal() }, async analyzer => {
				const observation = (await analyzer.frame(timing(source, 4))).assets.find(item => item.id === "tone");
				if (spec.hidden) {
					assert.equal(observation?.gainEnvelope, undefined);
					if (observation) assert.equal(observation.volume, 0);
					return;
				}
				assert.ok(observation, `${spec.name}: missing native observation`);
				assert.ok(Math.abs(observation.volume - reference.gain(frameTime(4))) < 2e-6,
					`${spec.name}: native observation disagrees with independent upstream oracle`);
				assert.ok(observation.gainEnvelope, `${spec.name}: declarative native envelope missing`);
				const expectedPoints: Point[] = reference.lane?.points ?? reference.gsapPoints.map(point => ({ t: point.time, v: point.volume }));
				assert.equal(observation.gainEnvelope.points.length, expectedPoints.length, `${spec.name}: native point count changed`);
				for (let index = 0; index < expectedPoints.length; index++) {
					const actual: Point = observation.gainEnvelope.points[index];
					const expected: Point = expectedPoints[index];
					assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${spec.name}: native point shape changed`);
					for (const key of Object.keys(expected) as Array<keyof Point>) {
						// JSON number round trips between V8/Rust/JSC can differ by an
						// f64 ULP. The actual f32 PCM check below remains independent.
						assert.ok(Math.abs(actual[key]! - expected[key]!) <= 1e-12,
							`${spec.name}: native point ${index}.${key}: ${actual[key]} != ${expected[key]}`);
					}
				}
			});
			const full = await render(source, 0, durationFrames);
			assert.equal(full.frames, sampleAt(durationFrames));
			assert.equal(full.sampleOrigin, 0);
			let worst = 0, worstIndex = -1, worstActual = 0, worstExpected = 0, heldDifference = 0;
			for (let i = 0; i < full.frames; i++) {
				const gain = Math.fround(reference.gain(i / sampleRate));
				const videoFrame = Math.min(durationFrames - 1, Math.floor(i * frameRate.numerator / (sampleRate * frameRate.denominator)));
				const heldGain = Math.fround(reference.gain(frameTime(videoFrame)));
				for (let channel = 0; channel < 2; channel++) {
					const sourceValue = wav.readFloatLE(44 + i * 8 + channel * 4);
					const expected = Math.fround(sourceValue * gain), actual = full.pcm.readFloatLE(i * 8 + channel * 4);
					const error = Math.abs(actual - expected);
					if (error > worst) { worst = error; worstIndex = i * 2 + channel; worstActual = actual; worstExpected = expected; }
					heldDifference = Math.max(heldDifference, Math.abs(expected - Math.fround(sourceValue * heldGain)));
				}
			}
			assert.ok(worst <= 2e-6, `${spec.name}: PCM sample ${worstIndex}, actual=${worstActual}, expected=${worstExpected}, worst=${worst}`);
			if (!spec.hidden) assert.ok(heldDifference > 1e-4, `${spec.name}: fixture would not detect a video-frame-held gain`);
			const partials = [];
			for (const [firstFrame, frameCount] of [[3, 5], [8, 3]]) {
				const partial = await render(source, firstFrame, frameCount);
				assert.equal(partial.sampleOrigin, sampleAt(firstFrame));
				assert.equal(partial.frames, sampleAt(firstFrame + frameCount) - sampleAt(firstFrame));
				assert.deepEqual(partial.pcm, full.pcm.subarray(sampleAt(firstFrame) * 8, sampleAt(firstFrame + frameCount) * 8),
					`${spec.name}: fractional-frame partial/full PCM differs for ${firstFrame}+${frameCount}`);
				partials.push({ firstFrame, frameCount, sampleOrigin: partial.sampleOrigin, frames: partial.frames });
			}
			totalSamples += full.frames * 2;
			console.log(JSON.stringify({ phase: "native-envelope-pcm", name: spec.name, passed: true,
				samplesChecked: full.frames * 2, worst, heldDifference, partials }));
		}
		succeeded = true;
		console.log(JSON.stringify({ passed: true, cases: selected.length, totalSamples,
			scope: "pinned HyperFrames compiler/analyzer + real Rust/WASM schedule/mix + source-rate float PCM + upstream native oracle" }));
	} finally {
		if (dirname(root) !== parent || !basename(root).startsWith("rocut-hf-envelope-")) throw Error("Unsafe envelope fixture cleanup");
		if (succeeded) await rm(root, { recursive: true, force: true });
		else console.error(`Envelope diagnostic failed; original fixtures retained at ${root}`);
	}
}
