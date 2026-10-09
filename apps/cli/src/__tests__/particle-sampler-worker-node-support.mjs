import { fork } from "node:child_process";
import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
const modulePath = process.argv[2],
	temp = process.env.TEMP;
if (!modulePath || !isAbsolute(modulePath) || !temp || !isAbsolute(temp))
	throw Error("Explicit absolute module and TEMP required");
const owned = [];
function launch(moduleUrl) {
	const child = fork(
		fileURLToPath(
			new URL(
				"../programmatic/particle-sampler-worker-entry.mjs",
				import.meta.url,
			),
		),
		[],
		{
			execPath: process.execPath,
			execArgv: [],
			windowsHide: true,
			stdio: ["ignore", "ignore", "ignore", "ipc"],
			serialization: "json",
		},
	);
	let didClose = false;
	const closed = new Promise((resolve) =>
		child.once("close", (code) => {
			didClose = true;
			resolve(code);
		}),
	);
	function wait(kind) {
		return new Promise((resolve, reject) => {
			const cleanup = () => {
				child.off("message", message);
				child.off("error", fail);
				child.off("close", close);
			};
			const fail = (e) => {
				cleanup();
				reject(e);
			};
			const close = () => fail(Error("Process closed"));
			const message = (m) => {
				if (m.kind === kind) {
					cleanup();
					resolve(m);
				} else if (m.kind === "failure") fail(Error("Worker failed"));
			};
			child.on("message", message);
			child.on("error", fail);
			child.on("close", close);
		});
	}
	const ready = wait("ready");
	void ready.catch(() => {});
	const owner = {
		child,
		ready,
		wait,
		closed,
		didClose: () => didClose,
		async stop() {
			if (!didClose && child.exitCode === null && child.signalCode === null)
				child.kill("SIGKILL");
			await closed;
		},
	};
	owned.push(owner);
	child.on("message", (message) => {
		if (message.kind === "policy")
			child.send({
				version: 1,
				kind: "init",
				publishedPolicyJson: message.policyJson,
				policyJson: message.policyJson,
			});
	});
	child.send({
		version: 1,
		kind: "discover",
		moduleUrl,
	});
	return owner;
}
const request = (child, id, count) =>
	child.send({
		version: 1,
		operation: "particleSurface",
		id,
		requestJson: JSON.stringify({
			triangles: [
				{
					position: [
						[0, 0, 0],
						[1, 0, 0],
						[0, 1, 0],
					],
					primitiveIndex: 7,
				},
			],
			count,
			seed: 42,
		}),
	});
const timeout = setTimeout(() => {
	for (const item of owned) item.child.kill("SIGKILL");
	process.exit(2);
}, 6000);
const directory = mkdtempSync(join(temp, "particle-sampler-node-")),
	markerPath = join(directory, "entered");
try {
	const wasm = launch(pathToFileURL(modulePath).href);
	await wasm.ready;
	const goodResult = wasm.wait("result");
	request(wasm.child, 1, 2);
	const good = JSON.parse((await goodResult).responseJson);
	const badResult = wasm.wait("result");
	request(wasm.child, 2, 65537);
	const bad = JSON.parse((await badResult).responseJson);
	await wasm.stop();
	if (
		good.ok !== true ||
		good.samples.length !== 2 ||
		bad.ok !== false ||
		bad.error.code !== "sampleCount"
	)
		throw Error("Rust round-trip failed");
	const missing = launch(
		new URL("./particle-sampler-worker-absent.mjs", import.meta.url).href,
	);
	await missing.ready.then(
		() => {
			throw Error("Missing module unexpectedly ready");
		},
		() => {},
	);
	await missing.stop();
	const hanging = launch(
		new URL("./particle-sampler-worker-init-support.mjs", import.meta.url).href,
	);
	let initialized = false;
	void hanging.ready.then(
		() => {
			initialized = true;
		},
		() => {},
	);
	await delay(100);
	if (initialized) throw Error("Hanging initializer reported ready");
	await hanging.stop();
	const crash = launch(
		new URL("./particle-sampler-worker-crash-support.mjs", import.meta.url)
			.href,
	);
	await crash.ready;
	request(crash.child, 1, 2);
	const crashExit = await crash.closed;
	const busy = launch(
		new URL("./particle-sampler-worker-blocking-support.mjs", import.meta.url)
			.href,
	);
	await busy.ready;
	busy.child.send({
		version: 1,
		operation: "particleSurface",
		id: 1,
		requestJson: JSON.stringify({ markerPath }),
	});
	for (let i = 0; !existsSync(markerPath) && i < 200; i++) await delay(5);
	if (!existsSync(markerPath)) throw Error("WASM loop not entered");
	await delay(20);
	if (busy.didClose()) throw Error("WASM loop exited before cancellation");
	await busy.stop();
	console.log(
		JSON.stringify({
			runtime: process.release.name,
			success: true,
			rustError: "sampleCount",
			didExit: wasm.didClose(),
			busyExit: busy.didClose(),
			initTimeoutExit: hanging.didClose(),
			missingModuleExit: missing.didClose(),
			crashExit,
		}),
	);
} finally {
	clearTimeout(timeout);
	await Promise.all(owned.map((item) => item.stop()));
	if (existsSync(markerPath)) unlinkSync(markerPath);
	rmdirSync(directory);
}
