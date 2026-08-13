import { describe, expect, test } from "bun:test";
import type { WorkerRequest } from "@opencut/editor-ports";
import {
	BrowserAssetResolver,
	BrowserRuntimeAssetLoader,
	createBrowserRuntimePorts,
	type PlatformWorkerLike,
	resolveHostPath,
} from "../browser-runtime";

class FakeWorker implements PlatformWorkerLike {
	readonly added: Array<{ type: string; listener: EventListener }> = [];
	readonly removed: Array<{ type: string; listener: EventListener }> = [];
	readonly sent: Array<{ message: unknown; transfer?: Transferable[] }> = [];
	terminated = 0;

	postMessage(message: unknown, transfer?: Transferable[]): void {
		this.sent.push({ message, transfer });
	}
	addEventListener(type: "message" | "error", listener: EventListener): void {
		this.added.push({ type, listener });
	}
	removeEventListener(
		type: "message" | "error",
		listener: EventListener,
	): void {
		this.removed.push({ type, listener });
	}
	terminate(): void {
		this.terminated += 1;
	}
	emit(type: "message" | "error", event: Event): void {
		for (const entry of this.added) {
			if (
				entry.type === type &&
				!this.removed.some((r) => r.listener === entry.listener)
			) {
				entry.listener(event);
			}
		}
	}
}

function workerRequest(
	url = "https://editor.invalid/worker.js",
): WorkerRequest {
	return {
		id: "transcription" as WorkerRequest["id"],
		url: new URL(url),
		type: "module",
		name: "OpenCut transcription",
	};
}

describe("browser Host runtime ports", () => {
	test("keeps relative, path, encoded, query and absolute bases immutable", () => {
		const cases = [
			["embed", "embed/fonts/a%20b.json"],
			["/embed/", "/embed/fonts/a%20b.json"],
			["/embed/?ignored=yes", "/embed/fonts/a%20b.json"],
			[
				"https://host.invalid/embed/",
				"https://host.invalid/embed/fonts/a%20b.json",
			],
		] as const;
		for (const [base, expected] of cases) {
			const resolver = new BrowserAssetResolver(base);
			expect(resolver.resolve({ ref: { path: "fonts/a%20b.json" } })).toBe(
				expected,
			);
			expect(Object.isFrozen(resolver)).toBe(true);
		}
	});

	test("rejects root, traversal, encoded traversal, schemes and backslashes", () => {
		const resolver = new BrowserAssetResolver("/embed/");
		for (const path of [
			"",
			"/fonts/a.json",
			"../secret",
			"fonts/../secret",
			"fonts/%2e%2e/secret",
			"https://other.invalid/a",
			"fonts\\a.json",
		]) {
			expect(() => resolver.resolve({ ref: { path } })).toThrow();
		}
	});

	test("loads exact bytes, propagates abort and attributes HTTP failures", async () => {
		const calls: Array<{ url: string; signal?: AbortSignal }> = [];
		const loader = new BrowserRuntimeAssetLoader(
			new BrowserAssetResolver("/one/"),
			async (input, init) => {
				calls.push({
					url: input.toString(),
					signal: init?.signal ?? undefined,
				});
				if (input.toString().endsWith("missing.bin"))
					return new Response("no", { status: 404 });
				return new Response(Uint8Array.from([1, 2, 3]));
			},
		);
		const controller = new AbortController();
		expect(
			new Uint8Array(
				await loader.loadBytes({
					ref: { path: "a.bin" },
					signal: controller.signal,
				}),
			),
		).toEqual(Uint8Array.from([1, 2, 3]));
		expect(calls).toEqual([{ url: "/one/a.bin", signal: controller.signal }]);
		await expect(
			loader.loadBytes({ ref: { path: "missing.bin" } }),
		).rejects.toThrow(/missing\.bin.*HTTP 404/);
	});

	test("accepts JSON content and rejects HTML fallback or malformed JSON at the boundary", async () => {
		const resolver = new BrowserAssetResolver("/base/");
		const responses = new Map([
			[
				"/base/good.json",
				new Response('{"ok":true}', {
					headers: { "content-type": "application/json" },
				}),
			],
			[
				"/base/html.json",
				new Response("<html></html>", {
					headers: { "content-type": "text/html" },
				}),
			],
			[
				"/base/bad.json",
				new Response("{", {
					headers: { "content-type": "application/problem+json" },
				}),
			],
		]);
		const loader = new BrowserRuntimeAssetLoader(
			resolver,
			async (input) => responses.get(input.toString())!,
		);
		expect(
			await loader.loadJson<{ ok: boolean }>({ ref: { path: "good.json" } }),
		).toEqual({ ok: true });
		await expect(
			loader.loadJson({ ref: { path: "html.json" } }),
		).rejects.toThrow(/content type text\/html/);
		await expect(
			loader.loadJson({ ref: { path: "bad.json" } }),
		).rejects.toThrow(/malformed/);
	});

	test("rewrites Worker URLs, adapts messages/errors/transfers and terminates exactly once", () => {
		const fake = new FakeWorker();
		const observed: Array<{ request: WorkerRequest; url: URL }> = [];
		const ports = createBrowserRuntimePorts({
			base: "/first/",
			fetch: async () => new Response(),
			rewriteWorkerUrl: () => new URL("https://host.invalid/rewrite/worker.js"),
			workerFactory: (args) => {
				observed.push(args);
				return fake;
			},
		});
		const request = workerRequest();
		const handle = ports.runtimeResources.createWorker({ request });
		const messages: unknown[] = [];
		const errors: string[] = [];
		const offMessage = handle.onMessage((event) => messages.push(event.data));
		handle.onError((event) => errors.push(event.message));
		const buffer = new ArrayBuffer(1);
		handle.postMessage({ message: "ping", transfer: [buffer] });
		fake.emit("message", new MessageEvent("message", { data: "pong" }));
		fake.emit("error", new ErrorEvent("error", { message: "boom" }));
		offMessage();
		fake.emit("message", new MessageEvent("message", { data: "late" }));
		handle.terminate();
		handle.terminate();

		expect(observed).toEqual([
			{ request, url: new URL("https://host.invalid/rewrite/worker.js") },
		]);
		expect(fake.sent).toEqual([{ message: "ping", transfer: [buffer] }]);
		expect(messages).toEqual(["pong"]);
		expect(errors).toEqual(["boom"]);
		expect(fake.terminated).toBe(1);
		expect(fake.removed.length).toBe(2);
	});

	test("keeps two adapter instances isolated", () => {
		const firstWorkers: FakeWorker[] = [];
		const secondWorkers: FakeWorker[] = [];
		const first = createBrowserRuntimePorts({
			base: "/first/",
			fetch: async () => new Response(),
			workerFactory: () => {
				const worker = new FakeWorker();
				firstWorkers.push(worker);
				return worker;
			},
		});
		const second = createBrowserRuntimePorts({
			base: "/second/",
			fetch: async () => new Response(),
			workerFactory: () => {
				const worker = new FakeWorker();
				secondWorkers.push(worker);
				return worker;
			},
		});

		expect(first.assets.resolve({ ref: { path: "logo.svg" } })).toBe(
			"/first/logo.svg",
		);
		expect(second.assets.resolve({ ref: { path: "logo.svg" } })).toBe(
			"/second/logo.svg",
		);
		first.runtimeResources
			.createWorker({ request: workerRequest() })
			.terminate();
		expect(firstWorkers).toHaveLength(1);
		expect(secondWorkers).toHaveLength(0);
		expect(Object.isFrozen(first)).toBe(true);
	});

	test("resolves Host service paths under the same base without using the asset port", () => {
		expect(resolveHostPath("/c4-next/", "api/feedback")).toBe(
			"/c4-next/api/feedback",
		);
		expect(resolveHostPath("https://host.invalid/c4/", "api/feedback")).toBe(
			"https://host.invalid/c4/api/feedback",
		);
		expect(() => resolveHostPath("/c4-next/", "/api/feedback")).toThrow(
			/logical and relative/,
		);
	});
});
