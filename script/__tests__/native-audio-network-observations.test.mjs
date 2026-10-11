import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	nativeAudioConsoleObservation,
	nativeAudioContextHttpObservation,
	nativeAudioDiagnosticUrl,
	nativeAudioServerObservation,
} from "../fixtures/native-audio-diagnostic-observations.mjs";
import {
	createNativeAudioNetworkObservations,
	recordNativeAudioNetworkObservation,
} from "../fixtures/native-audio-network-observations.mjs";
import { saveNativeAudioProbeFailure } from "../fixtures/native-audio-probe-diagnostics.mjs";

const sensitive =
	"http://user:secret@127.0.0.1:55/missing?token=private#fragment";
const sanitized = "http://127.0.0.1:55/missing";

test("diagnostic URLs never retain credentials, query, fragment or opaque payloads", () => {
	assert.equal(nativeAudioDiagnosticUrl({ value: sensitive }), sanitized);
	assert.equal(
		nativeAudioDiagnosticUrl({
			value: "/missing?token=private",
			pathOnly: true,
		}),
		"/missing",
	);
	assert.equal(
		nativeAudioDiagnosticUrl({ value: "data:text/plain,secret" }),
		"[non-http-url]",
	);
	assert.equal(nativeAudioDiagnosticUrl({ value: "invalid" }), null);
});

test("console and worker response metadata redact all URLs and never duplicate arbitrary message text", () => {
	const consoleRecord = nativeAudioConsoleObservation({
		message: {
			location: () => ({ url: sensitive, lineNumber: 2, columnNumber: 4 }),
			text: () => "status of 404 " + sensitive,
		},
		page: { url: () => sensitive },
	});
	assert.equal(consoleRecord.location.url, sanitized);
	assert.equal(consoleRecord.text, undefined);
	assert.equal(consoleRecord.textSha256.length, 64);
	const response = nativeAudioContextHttpObservation({
		url: () => sensitive,
		status: () => 404,
		request: () => ({
			frame() {
				throw Error("Worker request");
			},
			serviceWorker: () => ({ url: () => sensitive }),
			method: () => "GET",
			resourceType: () => "script",
		}),
	});
	assert.equal(response.frameUrl, null);
	assert.equal(response.serviceWorkerUrl, sanitized);
	for (const record of [consoleRecord, response]) {
		assert.ok(!JSON.stringify(record).includes("secret"));
		assert.ok(!JSON.stringify(record).includes("token=private"));
	}
});

test("server paths and retention remain bounded without intercepting the request", () => {
	const observations = createNativeAudioNetworkObservations();
	for (let index = 0; index < 70; index++) {
		recordNativeAudioNetworkObservation({
			observations,
			key: "viteHttpFailures",
			value: nativeAudioServerObservation({
				server: "vite",
				url: sensitive,
				method: "GET",
				status: 404,
			}),
		});
	}
	assert.equal(observations.viteHttpFailures[0].path, "/missing");
	assert.equal(observations.viteHttpFailures.length, 64);
	assert.equal(observations.dropped.viteHttpFailures, 6);
});

test("retained console 404s remain failed evidence even with valid AV output lengths", async () => {
	const errors = ["status of 404", "status of 404"];
	const report = await saveNativeAudioProbeFailure({
		failure: "console gate",
		errors,
		result: { frames: 6 },
		networkObservations: createNativeAudioNetworkObservations(),
	});
	assert.equal(report.passed, false);
	assert.equal(report.acceptanceEvidence, false);
	assert.deepEqual(report.errors, errors);
	const source = await readFile(
		new URL("../probe-remotion-audio.mjs", import.meta.url),
		"utf8",
	);
	assert.ok(source.includes("if (result.error || errors.length) throw Error"));
	assert.ok(source.includes("errors.push(message.text().slice(0, 1000))"));
});
