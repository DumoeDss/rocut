import { expect, test } from "bun:test";
import { attachParticleSamplerFrame } from "../programmatic/particle-broker-host";
import {
	assertParticleFrameConstraint,
	snapshotParticleFrameConstraint,
} from "../programmatic/particle-motion-contract";
import { fakeBrowser, identity } from "./particle-broker-test-support";
import {
	data,
	mappedFrame,
	motion,
	negativeBroker,
	wire,
} from "./particle-c3-test-support";

test("Host frame snapshot owns only exact Rust seed and integer source ticks", () => {
	const mutable = {
		...mappedFrame,
		time: 0.4004,
		timelineTime: 999_999,
		sampleTime: 48_049,
	};
	const snapshot = snapshotParticleFrameConstraint(mutable);
	mutable.seed++;
	mutable.sourceTime++;
	expect(snapshot).toEqual(mappedFrame);
	expect(Object.isFrozen(snapshot)).toBe(true);
	expect(() => assertParticleFrameConstraint(data(), snapshot)).not.toThrow();
	expect(() =>
		assertParticleFrameConstraint({ seed: mappedFrame.seed }, snapshot),
	).not.toThrow();
	expect(() => assertParticleFrameConstraint({ seed: 123 })).not.toThrow();
});

for (const [name, changes] of [
	["seed", { seed: mappedFrame.seed + 1 }],
	[
		"source tick",
		{ motion: { ...motion(), timeTicks: mappedFrame.sourceTime + 1 } },
	],
	["timeline time", { motion: { ...motion(), timeTicks: 999_999 } }],
	["floating-point seconds", { motion: { ...motion(), timeTicks: 0.4004 } }],
] as const) {
	test(`authorized page cannot choose a different ${name}`, async () => {
		const f = await negativeBroker();
		try {
			f.emit(wire(data(changes)));
			await expect(f.broker.failure).rejects.toThrow(
				/mapped frame|safe integer ticks/,
			);
			await expect(f.broker.check()).rejects.toThrow();
			expect(f.sampled()).toBe(0);
			expect(f.replies()).toHaveLength(0);
		} finally {
			await f.broker.dispose();
		}
	});
}

test("legacy sampling cannot override seed when the production Host owns a frame", async () => {
	const f = await negativeBroker();
	try {
		const request = data({ seed: mappedFrame.seed + 1 });
		delete request.motion;
		f.emit(wire(request));
		await expect(f.broker.failure).rejects.toThrow("Rust mapped frame");
		expect(f.sampled()).toBe(0);
	} finally {
		await f.broker.dispose();
	}
});

test("motion without a Host frame cannot use the legacy low-level broker allowance", async () => {
	const f = await negativeBroker({ expectedFrame: undefined });
	try {
		f.emit(wire(data()));
		await expect(f.broker.failure).rejects.toThrow("host-owned frame");
		expect(f.sampled()).toBe(0);
	} finally {
		await f.broker.dispose();
	}
});

test("mutating the caller's frame after broker attach cannot change the admitted seed or time", async () => {
	const mutable = { ...mappedFrame };
	const f = await negativeBroker({ expectedFrame: mutable });
	try {
		mutable.seed++;
		mutable.sourceTime += 4004;
		f.emit(
			wire(
				data({
					seed: mutable.seed,
					motion: { ...motion(), timeTicks: mutable.sourceTime },
				}),
			),
		);
		await expect(f.broker.failure).rejects.toThrow("Rust mapped frame");
		expect(f.sampled()).toBe(0);
	} finally {
		await f.broker.dispose();
	}
});

for (const [name, value] of [
	["missing", undefined],
	["null", null],
	["missing source ticks", { seed: 42, time: 0.4 }],
	["fractional source ticks", { ...mappedFrame, sourceTime: 0.4 }],
	[
		"unsafe source ticks",
		{ ...mappedFrame, sourceTime: Number.MAX_SAFE_INTEGER + 1 },
	],
	["negative source ticks", { ...mappedFrame, sourceTime: -1 }],
	["seed outside u32", { ...mappedFrame, seed: 0x1_0000_0000 }],
] as const) {
	test(`production sampler assembly rejects ${name} mapped frame before browser binding`, async () => {
		const transport = fakeBrowser();
		await expect(
			attachParticleSamplerFrame({
				browser: transport.browser,
				session: "cdp-session",
				executionContextId: 17,
				identity,
				mappedFrame: value,
				signal: new AbortController().signal,
				bootstrapTimeoutMs: 1000,
			}),
		).rejects.toThrow("Rust mapped seed and sourceTime");
		expect(transport.calls).toHaveLength(0);
		expect(transport.listeners.size).toBe(0);
	});
}
