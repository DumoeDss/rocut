import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { real, requestJson } from "./particle-sampler-worker-test-support";

const wasmPath = process.env.ROCUT_PARTICLE_WASM_MODULE;
const wasmTest = test.skipIf(!wasmPath);

test("production sync subpath resolves through the declared installed package", () => {
	const resolved = createRequire(import.meta.url).resolve("opencut-wasm/sync");
	expect(isAbsolute(resolved)).toBe(true);
	expect(resolved.endsWith("opencut_wasm_sync.js")).toBe(true);
});

wasmTest(
	"Bun real worker returns unmodified Rust success and errors then confirms exit",
	async () => {
		const w = real(wasmPath!);
		try {
			await w.ready;
			const success = await w.sampler(
				requestJson,
				new AbortController().signal,
			);
			expect(JSON.parse(success)).toMatchObject({ version: 1, ok: true });
			expect(JSON.parse(success).samples).toHaveLength(2);
			const bad = await w.sampler(
				requestJson.replace('"count":2', '"count":65537'),
				new AbortController().signal,
			);
			expect(JSON.parse(bad)).toMatchObject({
				version: 1,
				ok: false,
				error: { code: "sampleCount", path: "count" },
			});
		} finally {
			await w.terminateSampler();
		}
		expect(w.didExit()).toBe(true);
		expect(w.worker.exitCode !== null || w.worker.signalCode !== null).toBe(
			true,
		);
		await w.terminateSampler();
	},
);

wasmTest(
	"Node runs the same fixed worker entry with real Rust success/error and exit",
	() => {
		const result = spawnSync(
			"node",
			[
				fileURLToPath(
					new URL(
						"./particle-sampler-worker-node-support.mjs",
						import.meta.url,
					),
				),
				wasmPath!,
			],
			{
				encoding: "utf8",
				timeout: 8000,
				windowsHide: true,
			},
		);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toEqual({
			runtime: "node",
			success: true,
			rustError: "sampleCount",
			didExit: true,
			busyExit: true,
			initTimeoutExit: true,
			missingModuleExit: true,
			crashExit: 9,
		});
	},
);

wasmTest(
	"real response cap rejects inside the worker before returning Rust payload",
	async () => {
		const w = real(wasmPath!, { maxResponseJsonBytes: 64 });
		try {
			await w.ready;
			// Bun may report process close before delivering the internal failure
			// packet. Either ordering must reject, never expose oversized payload.
			await expect(
				w.sampler(requestJson, new AbortController().signal),
			).rejects.toThrow(/failed|exited unexpectedly/);
		} finally {
			await w.terminateSampler();
		}
		expect(w.didExit()).toBe(true);
		expect(w.worker.exitCode === 1 || w.worker.signalCode === "SIGKILL").toBe(
			true,
		);
	},
);

wasmTest(
	"immediate termination before readiness confirms process close without init-send races",
	async () => {
		const w = real(wasmPath!);
		const stop = w.terminateSampler();
		await expect(w.ready).rejects.toThrow("terminated");
		expect(w.terminateSampler()).toBe(stop);
		await stop;
		expect(w.didExit()).toBe(true);
	},
);

test("real busy synchronous WASM is force-terminated and all pending settle", async () => {
	const temp = process.env.TEMP;
	if (!temp || !isAbsolute(temp))
		throw Error("Test artifacts require explicit absolute TEMP");
	const directory = mkdtempSync(join(temp, "particle-sampler-bun-")),
		markerPath = join(directory, "entered");
	const w = real(
		fileURLToPath(
			new URL(
				"./particle-sampler-worker-blocking-support.mjs",
				import.meta.url,
			),
		),
		{ maxPendingRequests: 2 },
	);
	try {
		await w.ready;
		const controller = new AbortController();
		let completed = false;
		const active = w
			.sampler(JSON.stringify({ markerPath }), controller.signal)
			.then(
				() => {
					completed = true;
					return "unexpected success";
				},
				(e: Error) => e,
			);
		const queued = w
			.sampler("{}", new AbortController().signal)
			.catch((e: Error) => e);
		for (let tries = 0; !existsSync(markerPath) && tries < 200; tries++)
			await delay(5);
		expect(existsSync(markerPath)).toBe(true);
		await delay(20);
		expect(completed).toBe(false);
		expect(w.didExit()).toBe(false);
		controller.abort();
		expect(await active).toBeInstanceOf(Error);
		expect(await queued).toBeInstanceOf(Error);
		await w.terminateSampler();
		expect(w.didExit()).toBe(true);
		expect(w.worker.exitCode !== null || w.worker.signalCode !== null).toBe(
			true,
		);
		expect(await w.exited).toBeNumber();
		await expect(w.sampler("{}", new AbortController().signal)).rejects.toThrow(
			"aborted",
		);
	} finally {
		if (!w.didExit()) w.worker.kill("SIGKILL");
		await w.exited;
		if (existsSync(markerPath)) unlinkSync(markerPath);
		rmdirSync(directory);
	}
});

test("real missing module fails initialization and terminates without accepting late work", async () => {
	const w = real(
		fileURLToPath(
			new URL("./particle-sampler-worker-does-not-exist.mjs", import.meta.url),
		),
	);
	const pending = w
		.sampler("{}", new AbortController().signal)
		.catch((e: Error) => e);
	await expect(w.ready).rejects.toThrow();
	expect(await pending).toBeInstanceOf(Error);
	await w.terminateSampler();
	expect(w.didExit()).toBe(true);
});

test("Bun real initialization timeout and process crash confirm close", async () => {
	const never = real(
		fileURLToPath(
			new URL("./particle-sampler-worker-init-support.mjs", import.meta.url),
		),
		{ initTimeoutMs: 100 },
	);
	await expect(never.ready).rejects.toThrow("initialization timed out");
	await never.terminateSampler();
	expect(never.didExit()).toBe(true);
	const crashed = real(
		fileURLToPath(
			new URL("./particle-sampler-worker-crash-support.mjs", import.meta.url),
		),
	);
	await crashed.ready;
	await expect(
		crashed.sampler("{}", new AbortController().signal),
	).rejects.toThrow("exited");
	await crashed.terminateSampler();
	expect(crashed.didExit()).toBe(true);
	expect(crashed.worker.exitCode).toBe(9);
});
