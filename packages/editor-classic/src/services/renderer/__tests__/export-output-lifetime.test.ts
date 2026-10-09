import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { ExportOutputLifetime } from "../export-output-lifetime";
import {
	createNativeFixture,
	deferred,
} from "./export-output-lifetime-native-fixture";

if (process.env.ROCUT_OUTPUT_LIFETIME_ISOLATED !== "1") {
	test("output lifetime runs against real Mediabunny with isolated CPU WebCodecs", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: { ...process.env, ROCUT_OUTPUT_LIFETIME_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0) throw Error(result.stderr.toString());
	});
} else {
	test("early and repeated cancellation returns before a late supported first probe and closes its encoder once", async () => {
		const fixture = await createNativeFixture({ holdProbe: true });
		let drained = false;
		const add = fixture.add().finally(() => {
			drained = true;
		});
		await fixture.state.probeEntered.promise;
		await fixture.lifetime.cancel();
		await fixture.lifetime.cancel();
		expect(drained).toBe(false);
		expect(fixture.cancelCalls()).toBe(0);
		expect(fixture.state.created).toBe(0);
		fixture.releaseProbe();
		await add;
		expect(drained).toBe(true);
		expect(fixture.state.created).toBe(1);
		expect(fixture.state.closed).toBe(1);
		expect(fixture.output.state).toBe("canceled");
		await fixture.lifetime.cancel();
		expect(fixture.cancelCalls()).toBe(1);
		await expect(fixture.add()).rejects.toThrow("cancelled");
		expect(fixture.state.queries).toBe(1);
	});

	for (const outcome of ["unsupported", "rejected"] as const) {
		test(`late ${outcome} probe drains cleanup without creating an encoder`, async () => {
			const fixture = await createNativeFixture({ holdProbe: true });
			const result = fixture.add().then(
				() => null,
				(error: unknown) => error,
			);
			await fixture.state.probeEntered.promise;
			await fixture.lifetime.cancel();
			if (outcome === "unsupported") fixture.releaseProbe(false);
			else fixture.state.probe.reject(Error("late query failure"));
			expect(await result).toBeInstanceOf(Error);
			expect(fixture.state.created).toBe(0);
			expect(fixture.cancelCalls()).toBe(1);
			expect(fixture.output.state).toBe("canceled");
		});
	}

	test("already initialized first-frame backpressure starts cleanup before add drains", async () => {
		const fixture = await createNativeFixture({ blockEncode: true });
		let drained = false;
		const add = fixture.add().finally(() => {
			drained = true;
		});
		await fixture.state.encodeEntered.promise;
		await fixture.lifetime.cancel();
		expect(fixture.state.closed).toBe(1);
		expect(fixture.cancelCalls()).toBe(1);
		expect(drained).toBe(false);
		fixture.state.releaseBackpressure?.();
		await add;
		expect(drained).toBe(true);
		expect(fixture.cancelCalls()).toBe(1);
	});

	test("late initialization starts cleanup even when that first encode then hits backpressure", async () => {
		const fixture = await createNativeFixture({
			holdProbe: true,
			blockEncode: true,
		});
		const add = fixture.add();
		await fixture.state.probeEntered.promise;
		await fixture.lifetime.cancel();
		fixture.releaseProbe();
		await fixture.state.encodeEntered.promise;
		await fixture.lifetime.cancel();
		expect(fixture.state.closed).toBe(1);
		fixture.state.releaseBackpressure?.();
		await add;
		expect(fixture.cancelCalls()).toBe(1);
	});

	test("normal public output finalization closes the encoder without cancellation", async () => {
		const fixture = await createNativeFixture({ emitPackets: true });
		await fixture.add();
		fixture.source.close();
		await fixture.output.finalize();
		expect(fixture.output.state).toBe("finalized");
		expect(fixture.output.target.buffer?.byteLength).toBeGreaterThan(0);
		expect(fixture.state.created).toBe(1);
		expect(fixture.state.closed).toBe(1);
		expect(fixture.cancelCalls()).toBe(0);
	});

	test("the capture promise includes deferred cleanup and observes its rejection", async () => {
		const addGate = deferred<void>();
		const cleanupGate = deferred<void>();
		const cleanupStarted = deferred<void>();
		let calls = 0;
		const lifetime = new ExportOutputLifetime({
			cancel: () => {
				calls++;
				cleanupStarted.resolve();
				return cleanupGate.promise;
			},
		});
		let drained = false;
		const capture = lifetime
			.addVideoFrame(() => addGate.promise)
			.finally(() => {
				drained = true;
			})
			.then(
				() => null,
				(error: unknown) => error,
			);
		await lifetime.cancel();
		addGate.resolve();
		await cleanupStarted.promise;
		expect(drained).toBe(false);
		cleanupGate.reject(Error("cleanup failed"));
		expect(await capture).toEqual(Error("cleanup failed"));
		expect(drained).toBe(true);
		expect(calls).toBe(1);
		await expect(lifetime.cancel()).rejects.toThrow("cleanup failed");
		expect(calls).toBe(1);
	});

	test("late add and cleanup failures remain observed together", async () => {
		const addGate = deferred<void>();
		const lifetime = new ExportOutputLifetime({
			cancel: async () => {
				throw Error("cleanup failed");
			},
		});
		const result = lifetime
			.addVideoFrame(() => addGate.promise)
			.then(
				() => null,
				(error: unknown) => error,
			);
		await lifetime.cancel();
		addGate.reject(Error("query failed"));
		const error = await result;
		expect(error).toBeInstanceOf(AggregateError);
		if (!(error instanceof AggregateError)) throw Error("Expected both errors");
		expect(error.errors).toEqual([
			Error("query failed"),
			Error("cleanup failed"),
		]);
	});
}
