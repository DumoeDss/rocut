import assert from "node:assert/strict";
import { test as check } from "node:test";
import vm from "node:vm";
import {
	fixture,
	driver,
	read,
	installSetterSites,
} from "./hyperframes-native-seek-test-fixture.mjs";

// Pure CPU event-order checks over the repository's unchanged production strings.
// No browser, GPU, private toolchain, source-PTS oracle, or extended deadline.
const compiler = read(
	"apps/cli/src/programmatic/engines/hyperframes-compiler-child.ts",
);

await check(
	"Prior candidate breaks shared audio setter: audio-only lacks scope and mixed media rejects audio class",
	async () => {
		const only = fixture({ hasVideo: false });
		const caughtOnly = installSetterSites(only, false);
		only.context.site2(only.audio, 0.07999999999999);
		assert.equal(only.audio.currentTime, 0);
		assert.match(caughtOnly[0][1], /active frame fence/);
		const mixed = fixture();
		mixed.begin();
		const caughtMixed = installSetterSites(mixed, false);
		mixed.context.site3(mixed.audio, 0.12345599999999);
		assert.equal(mixed.audio.currentTime, 0);
		assert.match(caughtMixed[0][1], /Expected a video element/);
		await assert.rejects(
			mixed.context.rocutMedia.drainNativeFrame(),
			/Expected a video element/,
		);
		mixed.close();
	},
);

await check(
	"Both shared setter sites preserve rounded audio assignments without any native video scope",
	async () => {
		const f = fixture({ hasVideo: false });
		const caught = installSetterSites(f, true);
		f.context.site2(f.audio, 0.07999999999999);
		f.context.site3(f.audio, 0.12345599999999);
		assert.deepEqual(f.audioAssignments, [0.08, 0.123456]);
		assert.equal(caught.length, 0);
		assert.equal(f.log.length, 0);
	},
);

await check(
	"Both actual compiled video setter sites join the scope using unchanged rounded native targets",
	async () => {
		const f = fixture({ autoPresent: true });
		const caught = installSetterSites(f, true);
		f.begin();
		f.context.site2(f.video, 0.07999999999999);
		await f.context.rocutMedia.drainNativeFrame();
		f.context.site3(f.video, 0.12345599999999);
		await f.context.rocutMedia.drainNativeFrame();
		assert.deepEqual(
			f.log.filter(([type]) => type === "assign").map(([, time]) => time),
			[0.08, 0.123456],
		);
		assert.equal(f.log.filter(([type]) => type === "observe").length, 2);
		assert.equal(caught.length, 0);
		f.close();
	},
);

await check(
	"Audio-only native driver retains prepare/begin/check and original rounded source seeks",
	async () => {
		const f = fixture({ hasVideo: false, nativeAudio: true });
		const caught = installSetterSites(f, true);
		vm.runInContext(driver, f.context);
		await f.context.rocut.renderFrame({
			frameRate: { numerator: 100, denominator: 1 },
			time: 0.23,
		});
		assert.deepEqual(f.audioAssignments, [0.08, 0.123456]);
		assert.equal(caught.length, 0);
		assert.equal(f.log.length, 0);
		assert.deepEqual(f.audioEvents, [
			["prepare"],
			["begin", 0.23],
			["check", true],
		]);
	},
);

await check(
	"Mixed driver fences video only while both audio setter sites retain normalized direct assignment",
	async () => {
		const f = fixture({ autoPresent: true, nativeAudio: true });
		const caught = installSetterSites(f, true);
		vm.runInContext(driver, f.context);
		await f.context.rocut.renderFrame({
			frameRate: { numerator: 100, denominator: 1 },
			time: 0.23,
		});
		assert.deepEqual(f.audioAssignments, [0.08, 0.123456]);
		assert.equal(caught.length, 0);
		assert.equal(f.video.presentedMarker, 18);
		assert.equal(f.log.filter(([type]) => type === "observe").length, 2);
		assert.equal(f.callbacks.size, 0);
		assert.equal(f.liveListeners(), 0);
		assert.deepEqual(f.audioEvents, [
			["prepare"],
			["check", false],
			["begin", 0.23],
			["check", true],
		]);
	},
);

await check(
	"Mixed authored-audible video remains supported when native audio prepare mutes browser playback",
	async () => {
		const f = fixture({
			autoPresent: true,
			nativeAudio: true,
			authoredAudibleVideo: true,
		});
		assert.equal(f.video.muted, false);
		const caught = installSetterSites(f, true);
		vm.runInContext(driver, f.context);
		await f.context.rocut.renderFrame({
			frameRate: { numerator: 100, denominator: 1 },
			time: 0.23,
		});
		assert.equal(f.video.muted, true);
		assert.equal(f.video.presentedMarker, 18);
		assert.equal(caught.length, 0);
		assert.deepEqual(f.audioAssignments, [0.08, 0.123456]);
		assert.deepEqual(f.audioEvents, [
			["prepare"],
			["check", false],
			["begin", 0.23],
			["check", true],
		]);
	},
);

await check(
	"Pinned decoder patch preserves two native targets and rejects other match counts",
	async () => {
		assert.ok(
			compiler.includes("if ([...code.matchAll(decoderTime)].length !== 2)"),
		);
		assert.ok(
			compiler.includes(
				"if ([...code.matchAll(previewTolerance)].length !== 1)",
			),
		);
		const patternLine = compiler
			.split("\n")
			.find((line) => line.includes("const decoderTime ="));
		const pattern = vm.runInNewContext(
			patternLine.trim().replace("const decoderTime =", "").replace(/;$/, ""),
		);
		const replacement = compiler.match(
			/\.replace\(\s*decoderTime,\s*'([^']*)'\s*\)/,
		)[1];
		assert.ok(replacement.includes("$1 instanceof HTMLVideoElement"));
		assert.ok(replacement.includes("$1.currentTime=Math.round($2*1e6)/1e6"));
		const code =
			'v.currentTime=t}catch(e){f("runtime.media.site2",e)};v.currentTime=u}catch(e){f("runtime.media.site3",e)}';
		assert.equal([...code.matchAll(pattern)].length, 2);
		const transformed = code.replace(pattern, replacement);
		assert.ok(transformed.includes("nativeSeek(v,Math.round(t*1e6)/1e6)"));
		assert.ok(transformed.includes("nativeSeek(v,Math.round(u*1e6)/1e6)"));
	},
);
