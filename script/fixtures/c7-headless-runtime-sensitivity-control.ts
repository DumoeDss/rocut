import type { createInMemoryHost } from "@/editor/ports/in-memory/host";

const EMPTY_WASM_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

/**
 * Proof-only control that deliberately exercises every installed runtime probe.
 * It lives outside the product source tree so production editor/session code
 * never acquires platform resources directly.
 */
export async function exerciseHeadlessRuntimeSensitivity(args: {
	host: ReturnType<typeof createInMemoryHost>;
}): Promise<void> {
	const timeout = globalThis.setTimeout(() => undefined, 0);
	globalThis.clearTimeout(timeout);
	const interval = globalThis.setInterval(() => undefined, 1);
	globalThis.clearInterval(interval);

	if (typeof globalThis.requestAnimationFrame === "function") {
		const frame = globalThis.requestAnimationFrame(() => undefined);
		globalThis.cancelAnimationFrame(frame);
	}

	if (
		typeof globalThis.Worker === "function" &&
		typeof URL.createObjectURL === "function"
	) {
		const workerUrl = URL.createObjectURL(
			new Blob(["self.close();"], { type: "text/javascript" }),
		);
		try {
			const worker = new globalThis.Worker(workerUrl);
			worker.terminate();
		} finally {
			URL.revokeObjectURL(workerUrl);
		}
	}

	const audioScope = globalThis as typeof globalThis & {
		webkitAudioContext?: typeof AudioContext;
	};
	for (const AudioConstructor of [
		audioScope.AudioContext,
		audioScope.webkitAudioContext,
	]) {
		if (typeof AudioConstructor !== "function") continue;
		const context = new AudioConstructor();
		void context.close().catch(() => undefined);
	}

	if (typeof URL.createObjectURL === "function") {
		const objectUrl = URL.createObjectURL(new Blob(["c7-runtime-sensitivity"]));
		URL.revokeObjectURL(objectUrl);
	}

	const browserNavigator = globalThis.navigator as
		| (Navigator & {
				gpu?: { requestAdapter?: () => Promise<unknown> };
		  })
		| undefined;
	if (typeof browserNavigator?.gpu?.requestAdapter === "function") {
		void browserNavigator.gpu.requestAdapter().catch(() => undefined);
	}

	if (typeof WebAssembly.instantiate === "function") {
		void WebAssembly.instantiate(EMPTY_WASM_MODULE).catch(() => undefined);
	}
	if (typeof WebAssembly.instantiateStreaming === "function") {
		void WebAssembly.instantiateStreaming(
			Promise.resolve(
				new Response(EMPTY_WASM_MODULE, {
					headers: { "content-type": "application/wasm" },
				}),
			),
		).catch(() => undefined);
	}

	const hostWorker = args.host.runtimeResources.createWorker({
		request: {
			id: args.host.ids.next({ scope: "c7-sensitivity-worker" }),
			url: new URL("data:text/javascript,self.close()"),
			type: "classic",
			name: "c7-runtime-sensitivity",
		},
	});
	hostWorker.terminate();
	const hostAudio = args.host.runtimeResources.createAudioContext({
		request: { sampleRate: 48_000 },
	});
	await hostAudio.close();
	const hostObjectUrl = args.host.runtimeResources.createObjectUrl({
		blob: new Blob(["c7-host-runtime-sensitivity"]),
	});
	hostObjectUrl.revoke();
	args.host.environment.describeGraphics();
}
