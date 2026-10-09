import { expect } from "bun:test";
import { attachOffthreadBroker } from "../programmatic/offthread-broker";
import { PARTICLE_BINDING_NAME } from "../programmatic/particle-protocol";
import {
	boundaryFixture,
	check,
	rootContextId,
	session,
	tick,
} from "./particle-c2-boundary-support";

check(
	"only the discovered root context can sample real Rust and receive its reply",
	async () => {
		const f = await boundaryFixture();
		try {
			for (const context of [9, 22, 31]) f.emit(f.sample(), context);
			f.emit(f.sample(), rootContextId, "other-session");
			f.emit(f.sample(), rootContextId, session, "unrelated-binding");
			await f.broker.check();
			expect(f.sampled).toHaveLength(0);
			f.emit(f.sample());
			await f.broker.check();
			f.context.check();
			expect(f.sampled).toHaveLength(1);
			const result = JSON.parse(f.sampled[0].result);
			expect(result.ok).toBe(true);
			expect(result.samples).toHaveLength(1);
			expect(result.samples[0].primitiveIndex).toBe(7);
			expect(f.replies()).toHaveLength(1);
			expect(f.replies()[0].reply).toMatchObject({
				...f.identity,
				ok: true,
				responseJson: f.sampled[0].result,
			});
			expect(f.replies()[0].params.executionContextId).toBe(rootContextId);
			expect(
				f.calls.find((call) => call.method === "Runtime.addBinding")?.params,
			).toEqual({
				name: PARTICLE_BINDING_NAME,
				executionContextId: rootContextId,
			});
		} finally {
			await f.dispose();
		}
		expect(f.listeners.size).toBe(0);
		expect(f.stops()).toBe(1);
		expect(f.broker.retainedPayloadBytes).toBe(0);
	},
);

for (const key of ["sessionId", "captureId", "frameId", "sourceId"] as const) {
	check(
		`a wrong ${key} in the authorized root fails before real sampling`,
		async () => {
			const f = await boundaryFixture();
			try {
				f.emit(f.sample(1, { [key]: "other-grant" }));
				await expect(f.broker.failure).rejects.toThrow();
				await expect(f.capture()).rejects.toThrow();
				f.emit(f.sample(2));
				await tick();
				expect(f.sampled).toHaveLength(0);
				expect(
					f.calls.some((call) => call.method === "Page.captureScreenshot"),
				).toBe(false);
			} finally {
				await f.dispose();
			}
		},
	);
}

check(
	"completed request replay cannot produce a second Rust sample",
	async () => {
		const f = await boundaryFixture();
		try {
			f.emit(f.sample());
			await f.broker.check();
			f.emit(f.sample());
			await expect(f.broker.failure).rejects.toThrow(
				"Replayed particle request id",
			);
			expect(f.sampled).toHaveLength(1);
			expect(f.replies().filter((reply) => reply.reply.ok)).toHaveLength(1);
		} finally {
			await f.dispose();
		}
	},
);

check(
	"a prior capture grant cannot be replayed after successful cleanup",
	async () => {
		const first = await boundaryFixture();
		first.emit(first.sample());
		await first.broker.check();
		const old = first.sample(2);
		await first.dispose();
		const next = await boundaryFixture({ transport: first });
		try {
			expect(next.identity.captureId).not.toBe(first.identity.captureId);
			expect(next.identity.frameId).toBe(first.identity.frameId);
			expect(next.identity.sourceId).toBe(first.identity.sourceId);
			next.emit(old);
			await expect(next.broker.failure).rejects.toThrow();
			expect(next.sampled).toHaveLength(0);
		} finally {
			await next.dispose();
		}
		expect(next.listeners.size).toBe(0);
	},
);

check(
	"Particle and Offthread envelopes cannot cross their independent channels",
	async () => {
		const f = await boundaryFixture();
		let decoded = 0;
		const native = await attachOffthreadBroker({
			browser: f.browser,
			session,
			decoder: { ffmpeg: "unused", ffprobe: "unused" },
			code: "",
			resources: [],
			limits: { maxBytes: 4096, maxDimension: 320, maxElements: 4 },
			signal: f.controller.signal,
			decodeFrame: async () => {
				decoded++;
				throw Error("A cross-channel envelope reached the decoder");
			},
		});
		try {
			f.emit(f.sample(), rootContextId, session, "__rocutNativeFrameRequest");
			await expect(native.check()).rejects.toThrow();
			await f.broker.check();
			expect(f.sampled).toHaveLength(0);
			f.emit(f.sample());
			await f.broker.check();
			expect(f.sampled).toHaveLength(1);
			f.emit({
				version: 1,
				kind: "frame",
				id: 2,
				src: "data:video/mp4;base64,AA==",
				seconds: 0,
				transparent: false,
				toneMapped: false,
			});
			await expect(f.broker.failure).rejects.toThrow();
			expect(decoded).toBe(0);
		} finally {
			await f.dispose();
			await native.dispose();
		}
		expect(
			f.calls
				.filter((call) => call.method === "Runtime.removeBinding")
				.map((call) => call.params.name),
		).toEqual([PARTICLE_BINDING_NAME]);
		expect(f.listeners.size).toBe(0);
	},
);
