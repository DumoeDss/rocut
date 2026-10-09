import { expect } from "bun:test";
import { withHtmlCaptureCleanup } from "../programmatic/particle-capture";
import { deferred } from "./particle-broker-test-support";
import {
	boundaryFixture,
	check,
	pngBytes,
	rootContextId,
	session,
	tick,
} from "./particle-c2-boundary-support";

check(
	"an unawaited real Rust geometry failure prevents capture acceptance",
	async () => {
		const requestJson = JSON.stringify({
			triangles: [
				{
					position: [
						[0, 0, 0],
						[1, 0, 0],
						[0, 1, 0],
					],
					primitiveIndex: 7,
					color: [
						[2, 0, 0, 1],
						[2, 0, 0, 1],
						[2, 0, 0, 1],
					],
				},
			],
			count: 1,
			seed: 42,
		});
		const f = await boundaryFixture({
			send: async (method) => {
				if (method === "Runtime.evaluate") f.emit(f.sample(1, { requestJson }));
				return {};
			},
		});
		try {
			await expect(f.capture()).rejects.toThrow(
				"Rust particle surface sampling failed",
			);
			expect(f.sampled).toHaveLength(1);
			expect(JSON.parse(f.sampled[0].result).ok).toBe(false);
			expect(
				f.calls.some((call) => call.method === "Page.captureScreenshot"),
			).toBe(false);
		} finally {
			await f.dispose();
		}
	},
);

check(
	"production capture waits for unawaited sampling and the CDP reply acknowledgement",
	async () => {
		const delivery = deferred<void>(),
			reply = deferred<Record<string, unknown>>();
		const f = await boundaryFixture({
			deliver: delivery.promise,
			send: async (method) => {
				if (method === "Runtime.callFunctionOn") return reply.promise;
				if (method === "Runtime.evaluate") f.emit(f.sample());
				if (method === "Page.captureScreenshot")
					return { data: pngBytes.toString("base64") };
				return {};
			},
		});
		let settled = false;
		const frame = f.capture().then((value) => {
			settled = true;
			return value;
		});
		try {
			await tick();
			expect(f.sampled).toHaveLength(1);
			expect(f.replies()).toHaveLength(0);
			expect(settled).toBe(false);
			expect(
				f.calls.some((call) => call.method === "Page.captureScreenshot"),
			).toBe(false);
			delivery.resolve();
			await tick();
			expect(f.replies()).toHaveLength(1);
			expect(settled).toBe(false);
			expect(
				f.calls.some((call) => call.method === "Page.captureScreenshot"),
			).toBe(false);
			reply.resolve({});
			expect(await frame).toEqual(pngBytes);
			expect(
				f.calls.filter((call) => call.method === "Page.captureScreenshot"),
			).toHaveLength(1);
		} finally {
			delivery.resolve();
			reply.resolve({});
			await f.dispose();
		}
	},
);

for (const failure of [
	"cancel",
	"context-destroyed",
	"root-navigation",
] as const) {
	check(
		`production capture rejects ${failure} during pending real Rust delivery and suppresses a late reply`,
		async () => {
			const delivery = deferred<void>();
			const f = await boundaryFixture({ deliver: delivery.promise });
			f.emit(f.sample());
			const frame = f.capture();
			const observed = frame.then(
				() => null,
				(error) => error,
			);
			try {
				await tick();
				expect(f.sampled).toHaveLength(1);
				if (failure === "cancel")
					f.controller.abort(Error("test capture cancellation"));
				else
					f.emitEvent({
						sessionId: session,
						method:
							failure === "context-destroyed"
								? "Runtime.executionContextDestroyed"
								: "Page.frameNavigated",
						params:
							failure === "context-destroyed"
								? { executionContextId: rootContextId }
								: { frame: { id: "root-frame" } },
					});
				expect(await observed).toBeInstanceOf(Error);
				expect(
					f.calls.some((call) => call.method === "Page.captureScreenshot"),
				).toBe(false);
				// Navigation is owned by the context watcher; host cleanup owns broker abort.
				const cleanup = f.dispose();
				delivery.resolve();
				await cleanup;
				expect(f.sampled[0].signal.aborted).toBe(true);
				expect(f.replies().filter((reply) => reply.reply.ok)).toHaveLength(0);
				expect(f.listeners.size).toBe(0);
			} finally {
				delivery.resolve();
				await f.dispose();
			}
		},
	);
}

for (const failure of ["cancel", "context-destroyed", "reply-error"] as const) {
	check(`a screenshot in flight cannot hide ${failure}`, async () => {
		const screenshot = deferred<Record<string, unknown>>(),
			started = deferred<void>();
		const f = await boundaryFixture({
			send: async (method) => {
				if (method === "Page.captureScreenshot") {
					started.resolve();
					return screenshot.promise;
				}
				if (method === "Runtime.callFunctionOn")
					return { exceptionDetails: { text: "reply realm gone" } };
				return {};
			},
		});
		const frame = f.capture();
		const observed = frame.then(
			() => null,
			(error) => error,
		);
		try {
			await started.promise;
			if (failure === "cancel")
				f.controller.abort(Error("cancel during screenshot"));
			else if (failure === "context-destroyed")
				f.emitEvent({
					sessionId: session,
					method: "Runtime.executionContextDestroyed",
					params: { executionContextId: rootContextId },
				});
			else {
				f.emit(f.sample());
				await expect(f.broker.failure).rejects.toThrow(
					"Particle reply context failed",
				);
			}
			screenshot.resolve({ data: pngBytes.toString("base64") });
			expect(await observed).toBeInstanceOf(Error);
			expect(
				f.calls.filter((call) => call.method === "Page.captureScreenshot"),
			).toHaveLength(1);
		} finally {
			screenshot.resolve({ data: pngBytes.toString("base64") });
			await f.dispose();
		}
	});
}

check(
	"a screenshot transport error stays the primary cause while all cleanup is awaited",
	async () => {
		const stop = deferred<void>(),
			events: string[] = [];
		const screenshotError = Error("screenshot transport failed");
		const f = await boundaryFixture({
			send: async (method) => {
				if (method === "Page.captureScreenshot") throw screenshotError;
				return {};
			},
			terminate: async () => {
				events.push("terminate-start");
				await stop.promise;
				events.push("terminate-end");
			},
		});
		const frame = withHtmlCaptureCleanup({
			run: () => f.capture(),
			cleanupPage: async () => {
				events.push("page");
				throw Error("page cleanup failed");
			},
			disposeBrokers: [() => f.dispose()],
			closeBrowser: async () => {
				events.push("browser-close");
			},
		});
		const observed = frame.catch((error) => error);
		try {
			await tick();
			expect(events).toEqual(["page", "terminate-start"]);
			stop.resolve();
			const error = await observed;
			expect(error).toBeInstanceOf(AggregateError);
			expect(error.cause).toBe(screenshotError);
			expect(error.errors[0]).toBe(screenshotError);
			expect(events).toEqual([
				"page",
				"terminate-start",
				"terminate-end",
				"browser-close",
			]);
			expect(f.listeners.size).toBe(0);
		} finally {
			stop.resolve();
			await f.dispose();
		}
	},
);

check(
	"successful transport PNG is rejected if broker cleanup fails",
	async () => {
		const events: string[] = [];
		const f = await boundaryFixture({
			terminate: async () => {
				events.push("terminate");
				throw Error("termination not confirmed");
			},
		});
		await expect(
			withHtmlCaptureCleanup({
				run: () => f.capture(),
				cleanupPage: async () => {
					events.push("page");
				},
				disposeBrokers: [() => f.dispose()],
				closeBrowser: async () => {
					events.push("browser-close");
				},
			}),
		).rejects.toThrow("Particle broker cleanup failed");
		expect(events).toEqual(["page", "terminate", "browser-close"]);
		expect(f.listeners.size).toBe(0);
	},
);
