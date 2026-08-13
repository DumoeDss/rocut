/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The sensitivity test temporarily supplies absent platform boundaries and restores their exact descriptors. */
import { expect, test } from "bun:test";

import { installHeadlessRuntimeProbe } from "../headless-runtime-probe";

type MutableRecord = Record<string, unknown>;

function replaceForTest(args: {
	target: MutableRecord;
	key: string;
	value: unknown;
	restorers: Array<() => void>;
}): void {
	const descriptor = Object.getOwnPropertyDescriptor(args.target, args.key);
	Object.defineProperty(args.target, args.key, {
		configurable: true,
		enumerable: descriptor?.enumerable ?? false,
		writable: true,
		value: args.value,
	});
	args.restorers.push(() => {
		if (descriptor) Object.defineProperty(args.target, args.key, descriptor);
		else Reflect.deleteProperty(args.target, args.key);
	});
}

test("pre-load probe proves every global and Host sensitivity path", async () => {
	const restorers: Array<() => void> = [];
	const scope = globalThis as unknown as MutableRecord;
	class ProbeWorker {
		terminate(): void {}
	}
	class ProbeAudioContext {
		async close(): Promise<void> {}
	}
	class ProbeMutationObserver {
		observe(): void {}
		takeRecords(): MutationRecord[] {
			return [];
		}
		disconnect(): void {}
	}
	try {
		replaceForTest({
			target: scope,
			key: "document",
			value: {
				documentElement: {},
				querySelectorAll: () => [],
			},
			restorers,
		});
		replaceForTest({
			target: scope,
			key: "MutationObserver",
			value: ProbeMutationObserver,
			restorers,
		});
		replaceForTest({
			target: scope,
			key: "requestAnimationFrame",
			value: () => 17,
			restorers,
		});
		replaceForTest({
			target: scope,
			key: "cancelAnimationFrame",
			value: () => undefined,
			restorers,
		});
		replaceForTest({
			target: scope,
			key: "Worker",
			value: ProbeWorker,
			restorers,
		});
		replaceForTest({
			target: scope,
			key: "AudioContext",
			value: ProbeAudioContext,
			restorers,
		});
		replaceForTest({
			target: scope,
			key: "webkitAudioContext",
			value: ProbeAudioContext,
			restorers,
		});
		replaceForTest({
			target: scope,
			key: "navigator",
			value: { gpu: { requestAdapter: async () => ({}) } },
			restorers,
		});
		replaceForTest({
			target: WebAssembly as unknown as MutableRecord,
			key: "instantiateStreaming",
			value: async () => ({}),
			restorers,
		});

		const runtimeProbe = installHeadlessRuntimeProbe({
			host: "vite",
			environment: "browser",
			buildMarker: "c7-runtime-probe-sensitivity",
			entry: "headless-runtime-probe.test.ts",
		});
		runtimeProbe.markSubjectLoadStarted();
		const { InMemoryProjectStore, InMemoryRuntimeResourceHost } =
			await import("@opencut/editor-ports/in-memory");
		const { createInMemoryHost } =
			await import("@opencut/editor-ports/in-memory/host");
		const store = new InMemoryProjectStore();
		const runtime = new InMemoryRuntimeResourceHost();
		const host = {
			...createInMemoryHost({ projectId: "probe-project", store }),
			runtimeResources: runtime,
		};
		runtimeProbe.bindHost({
			host,
			intendedStore: store,
			intendedStoreIdentity: "InMemoryProjectStore",
			expectedProjectId: "probe-project",
		});

		const timeout = setTimeout(() => undefined, 60_000);
		clearTimeout(timeout);
		const interval = setInterval(() => undefined, 60_000);
		clearInterval(interval);
		const frame = requestAnimationFrame(() => undefined);
		cancelAnimationFrame(frame);
		new Worker("data:text/javascript,self.close()").terminate();
		await new AudioContext().close();
		const WebkitAudioContext = (
			globalThis as typeof globalThis & {
				webkitAudioContext: typeof AudioContext;
			}
		).webkitAudioContext;
		await new WebkitAudioContext().close();
		const objectUrl = URL.createObjectURL(new Blob(["probe"]));
		URL.revokeObjectURL(objectUrl);
		await (
			globalThis.navigator as Navigator & {
				gpu: { requestAdapter(): Promise<unknown> };
			}
		).gpu.requestAdapter();
		const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
		await WebAssembly.instantiate(wasm);
		await WebAssembly.instantiateStreaming(
			Promise.resolve(
				new Response(wasm, {
					headers: { "content-type": "application/wasm" },
				}),
			),
		);
		host.runtimeResources.createWorker({
			request: {
				id: host.ids.next({ scope: "probe-worker" }),
				url: new URL("data:text/javascript,export%20default%20true"),
				type: "module",
			},
		});
		host.runtimeResources.createAudioContext({ request: {} });
		host.runtimeResources.createObjectUrl({ blob: new Blob(["probe"]) });
		host.environment.describeGraphics();
		runtimeProbe.recordHostResourceState({
			workers: runtime.workers.length,
			audioContexts: runtime.audioContexts.length,
			objectUrls: runtime.objectUrls.length,
		});
		const observed = runtimeProbe.finish();

		expect(observed.events.map((entry) => entry.kind)).toEqual([
			"probe-installed",
			"subject-load-started",
			"host-bound",
			"subject-completed",
			"probe-restored",
		]);
		expect(observed.globalCalls).toEqual({
			timeouts: 1,
			intervals: 1,
			animationFrames: 1,
			workers: 1,
			audioContexts: 2,
			audioContextConstructions: 1,
			webkitAudioContextConstructions: 1,
			objectUrls: 1,
			webGpuAdapterRequests: 1,
			wasmInstantiations: 2,
			wasmInstantiateCalls: 1,
			wasmInstantiateStreamingCalls: 1,
		});
		expect(observed.hostCalls).toEqual({
			workers: 1,
			audioContexts: 1,
			objectUrls: 1,
			graphicsQueries: 1,
		});
		expect(
			observed.hookProvenance.global.hooks.map(({ path }) => path),
		).toEqual([
			"globalThis.setTimeout",
			"globalThis.setInterval",
			"globalThis.requestAnimationFrame",
			"globalThis.Worker",
			"globalThis.AudioContext",
			"globalThis.webkitAudioContext",
			"URL.createObjectURL",
			"navigator.gpu.requestAdapter",
			"WebAssembly.instantiate",
			"WebAssembly.instantiateStreaming",
		]);
		expect(
			observed.hookProvenance.global.hooks.every(
				({ status }) => status === "installed",
			),
		).toBeTrue();
		expect(observed.hostResourceState).toEqual({
			workers: 1,
			audioContexts: 1,
			objectUrls: 1,
		});
		expect(observed.compositorGpu).toEqual({
			strategy: "host-graphics+webgpu+wasm-construction",
			hostGraphicsQueries: 1,
			webGpuAdapterRequests: 1,
			wasmInstantiations: 2,
			ownershipAttempts: 4,
		});
	} finally {
		for (const restore of restorers.reverse()) restore();
	}
});

test("server probe records explicit DOM and unavailable-hook absence", () => {
	const runtimeProbe = installHeadlessRuntimeProbe({
		host: "next",
		environment: "server",
		buildMarker: "c7-runtime-probe-server-absence",
		entry: "headless-runtime-probe.test.ts",
	});
	runtimeProbe.markSubjectLoadStarted();
	const observed = runtimeProbe.finish();
	expect(observed.react).toEqual({
		strategy: "server-no-dom",
		domAvailable: false,
		mutationRecords: 0,
		rootMarkersBefore: 0,
		rootMarkersAfter: 0,
		mountAttempts: 0,
	});
	expect(observed.hookProvenance.react).toEqual({
		strategy: "server-no-dom/v1",
		hooks: [
			{
				path: "document.reactRootMarkers",
				status: "absent",
				detail: "server environment has no DOM document",
			},
			{
				path: "globalThis.MutationObserver",
				status: "absent",
				detail: "server environment has no DOM MutationObserver",
			},
		],
	});
	expect(
		observed.hookProvenance.global.hooks.every(
			({ status, detail }) =>
				status !== "unpatchable" && detail.trim().length > 0,
		),
	).toBeTrue();
});
