import { expect, test } from "bun:test";
import { metadataDriverFixture } from "./remotion-metadata-driver-fixture";

function commitFixture() {
	const paints: (() => void)[] = [];
	let clock = 0;
	const fixture = metadataDriverFixture({
		nativeCommit: "manual",
		paint: (callback) => paints.push(callback),
		now: () => clock,
		timeoutMs: 1000,
	});
	const start = () => {
		let settled = false;
		const pending = fixture.run();
		void pending.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			},
		);
		return { pending, settled: () => settled };
	};
	const microtasks = async () => {
		for (let i = 0; i < 30; i++) await Promise.resolve();
	};
	const paint = async () => {
		await microtasks();
		const callback = paints.shift();
		if (!callback) throw Error("Expected a genuine emitted-driver paint wait");
		callback();
		await microtasks();
	};
	return {
		...fixture,
		start,
		microtasks,
		paint,
		clock: (value: number) => {
			clock = value;
		},
	};
}

test("late native lazy content cannot pass the initial handle-empty window", async () => {
	const fixture = commitFixture(),
		outcome = fixture.start();
	await fixture.microtasks();
	expect(fixture.state.selections).toBe(1);
	for (let i = 0; i < 2; i++) await fixture.paint();
	expect(outcome.settled()).toBe(false);
	for (let i = 0; i < 3; i++) await fixture.paint();
	expect(outcome.settled()).toBe(false);
	expect(fixture.state.releases).toBe(0);
	expect(fixture.state.unmounts).toBe(0);
	fixture.commit();
	await fixture.paint();
	expect(fixture.state.releases).toBe(1);
	await fixture.paint();
	expect(outcome.settled()).toBe(false);
	await fixture.paint();
	await outcome.pending;
	expect(fixture.listeners.size).toBe(0);
	expect(fixture.state.unmounts).toBe(0);
});

test("a native asynchronous delay handle after commit resets the ordinary stable window", async () => {
	const fixture = commitFixture(),
		outcome = fixture.start();
	await fixture.microtasks();
	fixture.commit();
	await fixture.paint(); // Exit the pre-commit wait, release only Rocut's boot.
	await fixture.paint(); // First stable turn.
	fixture.window.remotion_delayRenderHandles = [37];
	fixture.window.remotion_renderReady = false;
	await fixture.paint();
	await fixture.paint();
	expect(outcome.settled()).toBe(false);
	fixture.window.remotion_delayRenderHandles = [];
	fixture.window.remotion_renderReady = true;
	await fixture.paint();
	expect(outcome.settled()).toBe(false);
	await fixture.paint();
	await outcome.pending;
	expect(fixture.state.releases).toBe(1);
});

test("legal empty composition completes on native commit without a nonempty DOM oracle", async () => {
	const fixture = commitFixture(),
		outcome = fixture.start();
	await fixture.microtasks();
	fixture.commit(); // The fixture Root returns null, with no rendered host node.
	for (let i = 0; i < 3; i++) await fixture.paint();
	await outcome.pending;
	expect(fixture.state.unmounts).toBe(0);
	expect(fixture.state.removed).toBe(0);
});

test("native Suspense content hidden after commit cannot pass a handle-empty gap", async () => {
	const fixture = commitFixture(),
		outcome = fixture.start();
	await fixture.microtasks();
	fixture.commit();
	await fixture.paint();
	await fixture.paint();
	fixture.uncommit();
	for (let i = 0; i < 3; i++) await fixture.paint();
	expect(outcome.settled()).toBe(false);
	fixture.commit();
	await fixture.paint();
	await fixture.paint();
	await outcome.pending;
});

test("stalled native lazy commit preserves the original 8000ms deadline and owns cleanup", async () => {
	const fixture = commitFixture(),
		outcome = fixture.start();
	await fixture.microtasks();
	fixture.clock(8001);
	await fixture.paint();
	await expect(outcome.pending).rejects.toThrow("frame readiness timed out");
	expect(fixture.state.releases).toBe(1);
	expect(fixture.state.unmounts).toBe(1);
	expect(fixture.state.removed).toBe(1);
	expect(fixture.listeners.size).toBe(0);
	fixture.commit();
	await fixture.microtasks();
	expect(fixture.state.releases).toBe(1);
});

test("native lazy rejection, cancelRender and realm teardown retain failure and cleanup", async () => {
	for (const mode of ["reject", "cancel", "teardown"] as const) {
		const fixture = commitFixture(),
			outcome = fixture.start();
		await fixture.microtasks();
		if (mode === "reject") fixture.rejectNative(Error("lazy import rejected"));
		else if (mode === "cancel")
			fixture.window.remotion_cancelledError = "native cancel reason";
		else fixture.teardown();
		await fixture.paint();
		await expect(outcome.pending).rejects.toThrow(
			mode === "reject"
				? "lazy import rejected"
				: mode === "cancel"
					? "native cancel reason"
					: "realm torn down",
		);
		expect(fixture.state.releases).toBe(1);
		expect(fixture.state.unmounts).toBe(1);
		expect(fixture.state.removed).toBe(1);
		expect(fixture.listeners.size).toBe(0);
	}
});
