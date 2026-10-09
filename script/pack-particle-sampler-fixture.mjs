// Bundled by the packaging test, then run by plain Node outside the checkout.
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { createParticleSamplerWorker } from "../apps/cli/src/programmatic/particle-sampler-worker.ts";

assert.equal(process.release.name, "node");
assert.deepEqual(process.execArgv, []);
assert.throws(
	() => createRequire(import.meta.url).resolve("opencut-wasm/sync"),
	{ code: "MODULE_NOT_FOUND" },
	"Standalone fixture must not resolve the source package",
);
const mode = process.argv[2];
assert.ok(
	["success", "rust-error", "cancel", "missing", "invalid"].includes(mode),
);
const triangle = {
	position: [
		[0, 0, 0],
		[1, 0, 0],
		[0, 1, 0],
	],
	primitiveIndex: 7,
};
const request = (count = 2, triangles = [triangle]) =>
	JSON.stringify({ triangles, count, seed: 42 });
const capture = new AbortController();
const originalFork = childProcess.fork;
const observed = [];
// Observe the real process; no fake worker/module/transport is substituted.
childProcess.fork = function (...args) {
	assert.equal(
		args[0],
		fileURLToPath(
			new URL("./particle-sampler-worker-entry.mjs", import.meta.url),
		),
	);
	assert.deepEqual(args[1], []);
	assert.equal(args[2].execPath, process.execPath);
	assert.deepEqual(args[2].execArgv, []);
	assert.equal(args[2].windowsHide, true);
	const child = Reflect.apply(originalFork, childProcess, args);
	const state = { child, started: 0, results: 0, exited: false, closed: false };
	observed.push(state);
	child.on("message", (message) => {
		if (message.kind === "started") {
			state.started++;
			if (mode === "cancel") capture.abort();
		}
		if (message.kind === "result") state.results++;
	});
	child.on("exit", () => {
		state.exited = true;
	});
	child.on("close", () => {
		state.closed = true;
	});
	return child;
};
syncBuiltinESMExports();
let worker;
const watchdog = setTimeout(() => {
	for (const { child, closed } of observed) if (!closed) child.kill("SIGKILL");
	process.exitCode = 2;
}, 12000);
try {
	let detail;
	if (mode === "missing" || mode === "invalid") {
		await assert.rejects(
			createParticleSamplerWorker({ bootstrapTimeoutMs: 5000 }),
		);
		detail = { initializationRejected: true, factoryRejected: true };
	} else {
		worker = await createParticleSamplerWorker({ bootstrapTimeoutMs: 5000 });
		await worker.ready;
		assert.equal(
			worker.publishedPolicyHash,
			"ac384e674e3f388ae11a674bd72c09786bc53cab2187cc4c3467ff0856635ba7",
		);
		assert.equal(worker.policy.maxRequestsPerFrame, 2);
		assert.equal(worker.policy.process.maxPendingRequests, 1);
		if (mode === "success") {
			const first = await worker.sampler(request(), capture.signal);
			const parsed = JSON.parse(first);
			assert.equal(parsed.ok, true);
			assert.equal(parsed.samples.length, 2);
			assert.equal(await worker.sampler(request(), capture.signal), first);
			detail = {
				samples: parsed.samples.length,
				deterministicReply: true,
			};
		} else if (mode === "rust-error") {
			// Direct worker-to-kernel error probe, separate from the two-request
			// deterministic capture above. This is not broker shape admission.
			const rawError = await worker.sampler(request(65537), capture.signal);
			const error = JSON.parse(rawError);
			assert.equal(error.ok, false);
			assert.equal(error.error.code, "sampleCount");
			assert.equal(error.error.path, "count");
			detail = {
				rustError: error.error.code,
			};
		} else {
			// Valid, substantial real Rust input. Abort on the real entry's started
			// acknowledgement, before a result. The published policy permits only
			// one pending request; a later call shares the already-aborted signal.
			const large = request(
				worker.policy.maxSamples,
				Array.from({ length: worker.policy.maxTriangles }, () => triangle),
			);
			assert.ok(Buffer.byteLength(large) < worker.policy.maxRequestJsonBytes);
			const active = assert.rejects(worker.sampler(large, capture.signal), {
				name: "AbortError",
			});
			await active;
			await assert.rejects(worker.sampler(request(), capture.signal), {
				name: "AbortError",
			});
			assert.equal(capture.signal.aborted, true);
			assert.equal(observed[0].started, 1);
			assert.equal(observed[0].results, 0);
			detail = {
				activeRejected: true,
				subsequentRejected: true,
				started: 1,
				resultsBeforeClose: 0,
			};
		}
	}
	await worker?.terminateSampler();
	await worker?.terminateSampler();
	const expectedProcesses = mode === "invalid" ? 0 : 1;
	assert.equal(
		observed.length,
		expectedProcesses,
		"A terminal capture must never restart",
	);
	if (expectedProcesses) {
		assert.equal(observed[0].exited, true);
		assert.equal(
			observed[0].closed,
			true,
			"Termination must confirm the real process close event",
		);
		if (mode === "cancel") assert.equal(observed[0].results, 0);
	}
	if (worker)
		await assert.rejects(
			worker.sampler(request(), new AbortController().signal),
		);
	assert.equal(observed.length, expectedProcesses);
	console.log(
		JSON.stringify({
			mode,
			runtime: process.version,
			standalone: true,
			processClosed: observed[0]?.closed === true,
			processNotStarted: observed.length === 0,
			...detail,
		}),
	);
} finally {
	await worker?.terminateSampler();
	clearTimeout(watchdog);
	childProcess.fork = originalFork;
	syncBuiltinESMExports();
}
