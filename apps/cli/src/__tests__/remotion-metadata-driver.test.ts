import { expect, test } from "bun:test";
import { metadataDriverFixture } from "./remotion-metadata-driver-fixture";

test("actual frame driver validates returned props without changing original input props and keeps successful root", async () => {
	const fixture = metadataDriverFixture({
		resolve: async () => ({
			width: 64,
			height: 32,
			fps: 30,
			durationInFrames: 10,
			props: { list: [1, 2], color: "red" },
		}),
	});
	await fixture.run();
	expect(fixture.state.calls[0].inputProps).toEqual({
		defaultValue: 4,
		supplied: 3,
	});
	expect(fixture.spec.inputProps).toEqual({ supplied: 3 });
	expect(fixture.state.renderedMetadata).toHaveLength(2);
	expect(fixture.state.selections).toBe(1);
	expect(fixture.state.unmounts).toBe(0);
	expect(fixture.state.releases).toBe(1);
	expect(fixture.listeners.size).toBe(0);
	expect(Object.isFrozen(fixture.spec.inputProps)).toBe(true);
	expect(() => {
		fixture.spec.inputProps.supplied = 7;
	}).toThrow();
});

test("actual frame driver rejects geometry, props and array-order drift before native output selection", async () => {
	for (const changed of [
		{ props: { color: "blue", list: [1, 2] } },
		{ props: { color: "red", list: [2, 1] } },
		{ width: 65 },
	]) {
		const fixture = metadataDriverFixture({
			resolve: async () => ({
				width: 64,
				height: 32,
				fps: 30,
				durationInFrames: 10,
				props: { color: "red", list: [1, 2] },
				...changed,
			}),
		});
		await expect(fixture.run()).rejects.toThrow();
		expect(fixture.state.renderedMetadata).toEqual([null]);
		expect(fixture.state.selections).toBe(0);
		expect(fixture.state.unmounts).toBe(1);
		expect(fixture.state.removed).toBe(1);
		expect(fixture.state.releases).toBe(1);
		expect(fixture.listeners.size).toBe(0);
	}
});

test("actual inspection driver rejects illegal actual props before transport, not JSON.stringify substitutes", async () => {
	for (const props of [
		{ color: new Date() },
		{ color: undefined },
		{ color: NaN },
	]) {
		const fixture = metadataDriverFixture({
			inspection: true,
			resolve: async () => ({
				width: 64,
				height: 32,
				fps: 30,
				durationInFrames: 10,
				props,
			}),
		});
		await expect(fixture.run()).rejects.toThrow("JSON");
		expect(fixture.state.unmounts).toBe(1);
		expect(fixture.listeners.size).toBe(0);
	}
});

test("both emitted drivers bound ignored-signal metadata and ignore late settlements", async () => {
	for (const inspection of [false, true]) {
		let settle!: (value: {
			width: number;
			height: number;
			fps: number;
			durationInFrames: number;
			props: unknown;
		}) => void;
		const fixture = metadataDriverFixture({
			inspection,
			timeoutMs: 25,
			resolve: () =>
				new Promise((resolve) => {
					settle = resolve;
				}),
		});
		await expect(fixture.run()).rejects.toThrow("timed out");
		const signal = fixture.state.calls[0].signal;
		if (!(signal instanceof AbortSignal))
			throw Error("Native metadata abort signal missing");
		expect(signal.aborted).toBe(true);
		settle({
			width: 64,
			height: 32,
			fps: 30,
			durationInFrames: 10,
			props: { color: "red", list: [1, 2] },
		});
		await Promise.resolve();
		expect(fixture.state.unmounts).toBe(1);
		expect(fixture.state.selections).toBe(0);
		expect(fixture.listeners.size).toBe(0);
	}
});

test("both emitted drivers cancel stalled metadata on cancelRender and realm teardown", async () => {
	for (const inspection of [false, true])
		for (const teardown of [false, true]) {
			const fixture = metadataDriverFixture({
				inspection,
				timeoutMs: 250,
				resolve: () => new Promise(() => {}),
			});
			const pending = fixture.run();
			// Await microtasks until the actual native metadata call is in flight.
			for (let i = 0; i < 20 && !fixture.state.calls.length; i++)
				await Promise.resolve();
			expect(fixture.state.calls).toHaveLength(1);
			if (teardown) fixture.teardown();
			else fixture.window.remotion_cancelledError = "author cancelled";
			await expect(pending).rejects.toThrow(
				teardown ? "realm torn down" : "author cancelled",
			);
			const signal = fixture.state.calls[0].signal;
			if (!(signal instanceof AbortSignal))
				throw Error("Native metadata abort signal missing");
			expect(signal.aborted).toBe(true);
			expect(fixture.state.unmounts).toBe(1);
			expect(fixture.listeners.size).toBe(0);
		}
});
