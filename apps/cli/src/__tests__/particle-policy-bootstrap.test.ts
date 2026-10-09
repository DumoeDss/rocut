import { expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnParticleSamplerProcess } from "../programmatic/particle-sampler-worker-process";
import { bootstrapParticleSamplerProcess } from "../programmatic/particle-sampler-worker-bootstrap";

test("missing/malformed Rust getters fail closed and confirm actual process close", async () => {
	for (const module of [
		"particle-policy-missing-getter-support.mjs",
		"particle-policy-invalid-getter-support.mjs",
	]) {
		const spawned = spawnParticleSamplerProcess(
			new URL(module, import.meta.url).href,
		);
		let closed = false;
		spawned.child.once("close", () => {
			closed = true;
		});
		await expect(
			bootstrapParticleSamplerProcess(spawned, 3000),
		).rejects.toThrow();
		expect(closed).toBe(true);
		expect(
			spawned.child.exitCode !== null || spawned.child.signalCode !== null,
		).toBe(true);
	}
});

test("a synchronous WASM getter is bounded by host deadline and force-terminated", async () => {
	const spawned = spawnParticleSamplerProcess(
		new URL("particle-policy-getter-blocking-support.mjs", import.meta.url)
			.href,
	);
	let closed = false;
	spawned.child.once("close", () => {
		closed = true;
	});
	const marker = join(
		tmpdir(),
		`particle-policy-getter-${spawned.child.pid}.entered`,
	);
	try {
		await expect(bootstrapParticleSamplerProcess(spawned, 500)).rejects.toThrow(
			"timed out",
		);
		expect(existsSync(marker)).toBe(true);
		expect(closed).toBe(true);
		expect(spawned.child.signalCode).toBe("SIGKILL");
	} finally {
		if (existsSync(marker)) unlinkSync(marker);
	}
});

test("bootstrap capture abort confirms close before rejecting and cannot activate late", async () => {
	const spawned = spawnParticleSamplerProcess(
		new URL("particle-policy-getter-blocking-support.mjs", import.meta.url)
			.href,
	);
	const controller = new AbortController();
	let closed = false;
	spawned.child.once("close", () => {
		closed = true;
	});
	const pending = bootstrapParticleSamplerProcess(
		spawned,
		3000,
		undefined,
		controller.signal,
	);
	controller.abort();
	await expect(pending).rejects.toThrow("aborted");
	expect(closed).toBe(true);
	await expect(spawned.discovered).rejects.toThrow("exited");
});
