import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { installFrostScheduleClockAdapter } from "./frost-schedule-clock-adapter.mjs";
import { createScheduleFixture, FIXED_PARAMS, FROST_SCHEDULE_VERSION, SEEK_TICKS, sha256 } from "./frost-schedule-fixture.mjs";
import { openFrostScheduleHost } from "./frost-schedule-host.mjs";
import { installFlameWrapPresentationObserver } from "./flame-wrap-presentation-observer.mjs";
import { seek } from "./flame-wrap-editor-controls.mjs";
import { capture } from "./flame-wrap-editor-capture.mjs";
import { opaqueRgb, metric, accepts, thresholds } from "./flame-wrap-export-metrics.mjs";
import { measureTemporalChange, temporalThresholds } from "./frost-encoded-time-metrics.mjs";
import { blazePipelinePng } from "../probe-blaze-pipeline-png.mjs";

// Running this file requires an explicit exclusive GPU lease; preparation is separate.
const [configPath, root, attempt, resume] = process.argv.slice(2);
assert([4, 5, 6].includes(process.argv.length), "Expected immutableRuntimeConfig preparedPrivateRoot [newAttemptName] [resume-02]");
assert(attempt === undefined || /^[a-z0-9-]+$/u.test(attempt));
assert(resume === undefined || (resume === "resume-02" && attempt));
const config = JSON.parse(fs.readFileSync(configPath, "utf8")), cpu = JSON.parse(fs.readFileSync(root + "/cpu-receipt.json", "utf8"));
assert(cpu.ok && cpu.runtime === config.runtime);
const fixture = createScheduleFixture();
assert.equal(fixture.sourceSha256, JSON.parse(fs.readFileSync(root + "/fixture-contract.json", "utf8")).sourceSha256);
const previousDirectory = root + (resume ? "/actual-consumer-seek-fresh-02" : "/actual-consumer");
const previousAttemptPath = previousDirectory + "/receipt.json";
const previousAttempt = attempt && fs.existsSync(previousAttemptPath) ? JSON.parse(fs.readFileSync(previousAttemptPath, "utf8")) : undefined;
const previousAdvance = previousAttempt?.variants.find(row => row.mode === "advance");
const reuseAdvance = previousAttempt?.ok === false && !previousAdvance?.job &&
	previousAdvance?.referenceFrames.length === 13 && previousAdvance.referenceFrames.every(frame => frame.accepted) &&
	previousAdvance.renderTemporal.every(pair => pair.accepted);
const reuseCompletedAdvance = resume && previousAttempt?.ok === false && previousAdvance?.job?.status === "completed" &&
	previousAdvance.decodedFrames.length === 13 && previousAdvance.decodedFrames.every(frame => frame.accepted && accepts(frame.freshFormalPngParity)) &&
	previousAdvance.encodedTemporal.every(pair => pair.accepted) && previousAdvance.graphAndRevisionUnchanged;
const previousFreeze = previousAttempt?.variants.find(row => row.mode === "freeze");
const reuseFreeze = resume && !previousFreeze?.job && previousFreeze?.referenceFrames.length === 13 &&
	previousFreeze.renderTemporal.every(pair => pair.identifiable && !pair.accepted);
if (resume) assert(reuseCompletedAdvance && reuseFreeze, "Resume requires preserved completed positive producer and complete negative renders");
const out = root + "/actual-consumer" + (attempt ? "-" + attempt : "");
assert(!fs.existsSync(out), "Never restart or overwrite an existing attempt");
fs.mkdirSync(out);
const { chromium } = createRequire(new URL("../../package.json", import.meta.url))("playwright-core");
const report = { ok: false, scope: "Finite opaque Frost isolated schedule-clock normal production render and two normal SceneExporter jobs; test-only negative DTO serialization adapter",
	thresholds, temporalThresholds, pairSelection: fixture.pairs, variants: [], cleanup: [], pageErrors: [], externalRequests: [] };
const save = (file, value) => fs.writeFileSync(out + "/" + file, Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
let browser, host, page, liveJob, previousSeekTicks;
async function snapshot() { return { context: await host.request("context"), clips: await host.request("clips"), tracks: await host.request("tracks") }; }
async function readFrame(ticks, label, clipId = "frost-schedule") {
	let refreshHop;
	// Same-position UI seeks are correctly no-ops. Request a distinct real frame
	// first, then seek back; never accept a stale publication or cached screenshot.
	if (ticks === previousSeekTicks) {
		const hopTicks = ticks === 0 ? 4000 : 0;
		await seek(page, hopTicks, fixture.frameRate);
		// Waiting only for the playhead label permits render-request coalescing.
		// Await the intermediate actual publication before seeking back.
		const hop = await capture(page, { root: out, width: 64, height: 48, clipId: "frost-schedule", usePresentationObserver: true },
			hopTicks, 1, label + "-refresh-hop");
		refreshHop = { ticks: hopTicks, rgbaSha256: hop.sha256, publicationSerial: hop.publicationSerial,
			minimumSerial: hop.minimumSerial, stableSamples: hop.stableConsecutiveSamples };
	}
	await seek(page, ticks, fixture.frameRate);
	previousSeekTicks = ticks;
	const sample = await capture(page, { root: out, width: 64, height: 48, clipId, usePresentationObserver: true }, ticks, 1, label);
	const rgba = Buffer.from(sample.rgbaBase64, "base64"), rgb = opaqueRgb(rgba);
	save(label + ".png", Buffer.from(blazePipelinePng(rgba, 64, 48)));
	return { ticks, rgb, rgba, sha256: sha256(rgba), pngSha256: sha256(fs.readFileSync(out + "/" + label + ".png")), publicationSerial: sample.publicationSerial, refreshHop };
}
function temporal(frames) { return fixture.pairs.map(pair => ({ id: pair.id, ...measureTemporalChange({
	actualFirst: frames[pair.first], actualLast: frames[pair.last],
	expectedFirst: fixture.frames[pair.first].rgb, expectedLast: fixture.frames[pair.last].rgb, width: 64, height: 48 }) })); }
try {
	for (const pin of config.pins) assert.equal(sha256(fs.readFileSync(pin.path)), pin.sha256);
	browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
		args: ["--no-proxy-server", "--enable-unsafe-webgpu", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--use-gl=angle"],
		env: { ...process.env, TEMP: root, TMP: root } });
	if (reuseCompletedAdvance) {
		const row = structuredClone(previousAdvance);
		row.reusedCompletedProducer = { receipt: previousAttemptPath, receiptSha256: sha256(fs.readFileSync(previousAttemptPath)),
			scope: "Unique completed positive job reused without new capture, render or export" };
		for (const frame of row.referenceFrames) {
			const label = "advance-fresh-" + frame.index;
			for (const [file, expected] of [[label + ".png", frame.pngSha256], ["flame-wrap-editor-" + label + ".rgba", frame.rgbaSha256]]) {
				const bytes = fs.readFileSync(previousDirectory + "/" + file); assert.equal(sha256(bytes), expected); save(file, bytes);
			}
		}
		for (const file of ["advance.webm", "advance-ffprobe.json", "advance-decoded.rgb"]) save(file, fs.readFileSync(previousDirectory + "/" + file));
		assert.equal(sha256(fs.readFileSync(out + "/advance.webm")), row.video.sha256);
		report.variants.push(row);
	}
	for (const mode of reuseCompletedAdvance ? ["freeze"] : ["advance", "freeze"]) {
		host = await openFrostScheduleHost({ directory: root, runtime: config.runtime, toolchain: cpu.toolchain });
		const before = await snapshot(); assert.equal(before.context.revision, 1);
		const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
		await context.addInitScript(installFrostScheduleClockAdapter, { version: FROST_SCHEDULE_VERSION, params: FIXED_PARAMS, frozenTicks: 0, mode });
		await context.addInitScript(installFlameWrapPresentationObserver, { width: 64, height: 48 });
		page = await context.newPage();
		previousSeekTicks = undefined;
		page.on("pageerror", error => report.pageErrors.push(error.message));
		page.on("request", request => { const url = new URL(request.url());
			if (["http:", "https:"].includes(url.protocol) && url.origin !== new URL(host.editorUrl).origin)
				report.externalRequests.push({ origin: url.origin, type: request.resourceType() }); });
		await page.goto(host.editorUrl, { waitUntil: "commit" });
		await page.locator('[data-testid="timeline-clip"][data-element-id="frost-schedule"]').waitFor({ timeout: 90000 });
		const row = { mode, referenceFrames: [], frames: [], seek: [] }; report.variants.push(row);
		const baseline = await readFrame(52000, mode + "-disabled", "frost-schedule-disabled");
		row.disabledSourceSha256 = baseline.sha256;
		assert.equal(baseline.sha256, fixture.sourceSha256, "Production opaque source differs from independent source");
		const cached = mode === "advance" && reuseAdvance ? previousAdvance : mode === "freeze" && reuseFreeze ? previousFreeze : undefined;
		row.referenceCapture = cached ? {
			scope: "Reused preserved actual fresh production boundary PNG/RGBA, same immutable source/optics/oracle; independent gates rechecked before new producer job",
			receipt: previousAttemptPath, receiptSha256: sha256(fs.readFileSync(previousAttemptPath)),
		} : { scope: "New actual production publication boundary capture before this producer job" };
		for (const frame of fixture.frames) {
			let actual;
			if (cached) {
				const old = cached.referenceFrames[frame.index], label = mode + "-fresh-" + frame.index;
				const rgba = fs.readFileSync(previousDirectory + "/flame-wrap-editor-" + label + ".rgba");
				const png = fs.readFileSync(previousDirectory + "/" + label + ".png");
				assert.equal(sha256(rgba), old.rgbaSha256); assert.equal(sha256(png), old.pngSha256);
				save("flame-wrap-editor-" + label + ".rgba", rgba); save(label + ".png", png);
				actual = { rgb: opaqueRgb(rgba), rgba, sha256: old.rgbaSha256, pngSha256: old.pngSha256,
					publicationSerial: old.publicationSerial };
			} else actual = await readFrame(frame.ticks, mode + "-fresh-" + frame.index);
			const measurement = metric(actual.rgb, frame.rgb, baseline.rgb);
			row.referenceFrames.push({ index: frame.index, ticks: frame.ticks, rgbaSha256: actual.sha256,
				pngSha256: actual.pngSha256, publicationSerial: actual.publicationSerial, metric: measurement, accepted: accepts(measurement) });
			row.frames.push(actual.rgb);
		}
		row.renderTemporal = temporal(row.frames);
		if (mode === "advance") assert(row.referenceFrames.every(frame => frame.accepted) && row.renderTemporal.every(pair => pair.accepted));
		else assert(row.renderTemporal.every(pair => pair.identifiable && !pair.accepted), "Frozen render was not rejected");
		const observationStart = await page.evaluate(() => ({ calls: globalThis.__frostScheduleClockAudit.wasmCalls.length,
			serialized: globalThis.__frostScheduleClockAudit.serializations.length, encodes: globalThis.__frostScheduleClockAudit.encodeOptions.length }));
		const options = { format: "webm", quality: "very_high", videoChroma: "444", includeAudio: false, range: { startTime: 0, endTime: 52000 } };
		const response = await fetch(new URL("api/export", host.editorUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(options), signal: AbortSignal.timeout(15000) });
		const started = await response.json(); assert.equal(response.status, 202); liveJob = started.id;
		console.log(JSON.stringify({ mode, job: liveJob }));
		for (;;) { const job = await host.request("export/" + liveJob); row.job = job;
			if (["completed", "failed", "cancelled"].includes(job.status)) break;
			await new Promise(resolve => setTimeout(resolve, 500)); }
		liveJob = undefined; assert.equal(row.job.status, "completed", row.job.error); assert.deepEqual(row.job.options, options);
		row.observationStart = observationStart;
		row.audit = await page.evaluate(() => globalThis.__frostScheduleClockAudit);
		const encodes = row.audit.encodeOptions.slice(observationStart.encodes);
		assert.equal(encodes.length, 13); encodes.forEach((encode, index) => assert(Math.abs(encode.timestamp / 1000000 - index / 30) <= .0011));
		assert(encodes.every(encode => encode.options.vp9?.quantizer === 8));
		assert(row.audit.encoderConfigurations.some(encoder => encoder.width === 64 && encoder.height === 48 && encoder.bitrateMode === "quantizer"));
		assert(row.audit.serializations.every(call => call.dtoRestored && call.mutatedOnlyLocalTime));
		assert.deepEqual(row.audit.errors, []); assert(row.audit.wasmCalls.length > observationStart.calls);
		for (const call of row.audit.wasmCalls) {
			assert.equal(call.response.frameIndex, call.request.localTime / 4000);
			assert.equal(call.response.passes.length, 1);
			const uniforms = call.response.passes[0].uniforms;
			for (const key of ["amount", "coverage", "scale", "seed", "blur", "refraction", "tintStrength", "tintR", "tintG", "tintB"])
				assert.equal(uniforms[key], FIXED_PARAMS[key]);
			if (mode === "freeze") assert.equal(uniforms.strokeCount, 0);
		}
		const exportCalls = row.audit.serializations.slice(observationStart.serialized);
		assert(fixture.frames.every(frame => exportCalls.some(call => call.originalTicks === frame.ticks)), "Actual global effect inputs must advance");
		assert(exportCalls.every(call => call.serializedTicks === (mode === "freeze" ? 0 : call.originalTicks)));
		const bytes = fs.readFileSync(row.job.outputPath); save(mode + ".webm", bytes); row.video = { byteLength: bytes.length, sha256: sha256(bytes) };
		const probe = JSON.parse(execFileSync("E:/Software/ffmpeg-6.0-full_build/bin/ffprobe.exe", ["-v", "error", "-show_streams", "-show_frames", "-of", "json", out + "/" + mode + ".webm"], { windowsHide: true, timeout: 30000 }).toString("utf8"));
		save(mode + "-ffprobe.json", probe); assert.equal(probe.frames.length, 13); assert.equal(probe.streams[0].pix_fmt, "yuv444p");
		const decoded = execFileSync("E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe", ["-v", "error", "-i", out + "/" + mode + ".webm", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
		assert.equal(decoded.length, 13 * 64 * 48 * 3); save(mode + "-decoded.rgb", decoded);
		row.decodedFrames = fixture.frames.map((frame, index) => { const actual = decoded.subarray(index * 64 * 48 * 3, (index + 1) * 64 * 48 * 3),
			measurement = metric(actual, frame.rgb, baseline.rgb), parity = metric(actual, row.frames[index], baseline.rgb), pts = Number(probe.frames[index].best_effort_timestamp_time);
			assert(Math.abs(pts - index / 30) <= .0011); return { index, ticks: frame.ticks, pts, independent: measurement, accepted: accepts(measurement), freshFormalPngParity: parity }; });
		row.encodedTemporal = temporal(fixture.frames.map((_, index) => decoded.subarray(index * 64 * 48 * 3, (index + 1) * 64 * 48 * 3)));
		assert(row.decodedFrames.every(frame => accepts(frame.freshFormalPngParity)), "Both variants must preserve original encode/reference quality gates");
		if (mode === "advance") assert(row.decodedFrames.every(frame => frame.accepted && accepts(frame.freshFormalPngParity)) && row.encodedTemporal.every(pair => pair.accepted));
		else assert(row.encodedTemporal.every(pair => pair.identifiable && !pair.accepted), "Frozen encoded schedule was not rejected");
		row.pipelineCompletedBeforeSupplementalSeek = true;
		// Supplemental idempotence never prevents the unique producer job from being
		// observed. A failure remains a failure, retained separately after pipeline.
		for (const ticks of [...SEEK_TICKS, SEEK_TICKS[SEEK_TICKS.length - 1]]) {
			const actual = await readFrame(ticks, mode + "-seek-" + row.seek.length);
			assert.equal(actual.sha256, row.referenceFrames.find(frame => frame.ticks === ticks).rgbaSha256);
			row.seek.push({ ticks, rgbaSha256: actual.sha256, publicationSerial: actual.publicationSerial, refreshHop: actual.refreshHop });
		}
		row.supplementalAudit = await page.evaluate(() => globalThis.__frostScheduleClockAudit);
		delete row.frames;
		assert.deepEqual((await snapshot()).clips, before.clips); assert.equal((await host.request("context")).revision, 1); row.graphAndRevisionUnchanged = true;
		await page.evaluate(() => globalThis.__restoreFrostScheduleClockAdapter()); row.adapterRestored = await page.evaluate(() => globalThis.__frostScheduleClockAudit.restored);
		await context.close(); page = undefined; await host.close(); host = undefined; report.cleanup.push({ mode, hostAndContextClosed: true });
	}
	assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
	for (const pin of config.pins) assert.equal(sha256(fs.readFileSync(pin.path)), pin.sha256);
	report.ok = true;
} catch (error) {
	report.error = error.stack; report.captureObservation = error.captureObservation; process.exitCode = 1;
	if (page && !page.isClosed()) report.failureAudit = await page.evaluate(() => globalThis.__frostScheduleClockAudit).catch(() => undefined);
}
finally {
	if (liveJob) { report.liveRetained = true; report.liveJob = liveJob; report.ownedHostPid = host?.pid; }
	else { if (page) { await page.evaluate(() => globalThis.__restoreFrostScheduleClockAdapter?.()).catch(() => {}); await page.close(); }
		if (host) await host.close(); if (browser) { await browser.close(); report.cleanup.push({ browserClosed: true }); } }
	save("receipt.json", report);
	console.log(JSON.stringify({ ok: report.ok, variants: report.variants.map(row => ({ mode: row.mode, job: row.job?.id,
		renderTemporal: row.renderTemporal, encodedTemporal: row.encodedTemporal })), error: report.error, liveRetained: report.liveRetained }));
}
