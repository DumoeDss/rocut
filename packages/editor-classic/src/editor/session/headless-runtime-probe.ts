/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- This proof probe must wrap heterogeneous platform constructors and methods without importing them. */
import type { EditorHost } from "@opencut/editor-ports/host";
import type { ProjectStore } from "@opencut/editor-ports";

type ProbeHost = "node" | "vite" | "next";
type ProbeEnvironment = "browser" | "server" | "node";

interface CallCounts {
	timeouts: number;
	intervals: number;
	animationFrames: number;
	workers: number;
	audioContexts: number;
	audioContextConstructions: number;
	webkitAudioContextConstructions: number;
	objectUrls: number;
	webGpuAdapterRequests: number;
	wasmInstantiations: number;
	wasmInstantiateCalls: number;
	wasmInstantiateStreamingCalls: number;
}

interface HostCallCounts {
	workers: number;
	audioContexts: number;
	objectUrls: number;
	graphicsQueries: number;
}

type HookStatus = "installed" | "absent" | "unpatchable";

export interface HeadlessRuntimeHookObservation {
	readonly path: string;
	readonly status: HookStatus;
	readonly detail: string;
}

export interface HeadlessHostBindingObservation {
	readonly source: "fixture-explicit-createInMemoryHost";
	readonly expectedProjectId: string;
	readonly actualProjectId: string;
	readonly projectMatches: boolean;
	readonly intendedStoreIdentity: string;
	readonly actualStoreIdentity: string;
	readonly sameStoreInstance: boolean;
	readonly fallbackUsed: boolean;
}

export interface HeadlessRuntimeProbeSnapshot {
	readonly schemaVersion: 1;
	readonly implementation: "headless-runtime-probe/v1";
	readonly probeId: string;
	readonly host: ProbeHost;
	readonly environment: ProbeEnvironment;
	readonly buildMarker: string;
	readonly entry: string;
	readonly events: readonly {
		readonly sequence: number;
		readonly kind:
			| "probe-installed"
			| "subject-load-started"
			| "host-bound"
			| "subject-completed"
			| "probe-restored";
	}[];
	readonly hostBinding: HeadlessHostBindingObservation | null;
	readonly globalCalls: Readonly<CallCounts>;
	readonly hostCalls: Readonly<HostCallCounts>;
	readonly hookProvenance: {
		readonly global: {
			readonly strategy: "pre-load-callable-proxy/v1";
			readonly hooks: readonly HeadlessRuntimeHookObservation[];
		};
		readonly host: {
			readonly strategy: "post-bind-host-callable-proxy/v1";
			readonly hooks: readonly HeadlessRuntimeHookObservation[];
		};
		readonly react: {
			readonly strategy:
				| "browser-mutation-observer+root-marker-scan/v1"
				| "server-no-dom/v1";
			readonly hooks: readonly HeadlessRuntimeHookObservation[];
		};
		readonly compositorGpu: {
			readonly strategy: "derived-host-webgpu-wasm/v1";
			readonly fields: readonly [
				"hostGraphicsQueries",
				"webGpuAdapterRequests",
				"wasmInstantiations",
				"ownershipAttempts",
			];
		};
	};
	readonly hostResourceState: {
		readonly workers: number;
		readonly audioContexts: number;
		readonly objectUrls: number;
	} | null;
	readonly react: {
		readonly strategy:
			| "mutation-observer+react-container-markers"
			| "server-no-dom";
		readonly domAvailable: boolean;
		readonly mutationRecords: number;
		readonly rootMarkersBefore: number;
		readonly rootMarkersAfter: number;
		readonly mountAttempts: number;
	};
	readonly compositorGpu: {
		readonly strategy: "host-graphics+webgpu+wasm-construction";
		readonly hostGraphicsQueries: number;
		readonly webGpuAdapterRequests: number;
		readonly wasmInstantiations: number;
		readonly ownershipAttempts: number;
	};
}

export interface HeadlessRuntimeProbeController {
	markSubjectLoadStarted(): void;
	bindHost(args: {
		host: EditorHost;
		intendedStore: ProjectStore;
		intendedStoreIdentity: string;
		expectedProjectId: string;
	}): HeadlessHostBindingObservation;
	recordHostResourceState(args: {
		workers: number;
		audioContexts: number;
		objectUrls: number;
	}): void;
	finish(): HeadlessRuntimeProbeSnapshot;
}

type MutableRecord = Record<string, unknown>;

function constructorIdentity(value: unknown): string {
	if (!value || typeof value !== "object") return typeof value;
	const constructor = (value as { constructor?: { name?: unknown } })
		.constructor;
	return typeof constructor?.name === "string" && constructor.name.length > 0
		? constructor.name
		: "unknown-store";
}

function countReactRootMarkers(document: Document): number {
	const candidates = [
		document.documentElement,
		...document.querySelectorAll("*"),
	];
	return candidates.reduce(
		(count, element) =>
			count +
			(Number(
				Object.getOwnPropertyNames(element).some(
					(name) =>
						name === "_reactRootContainer" ||
						name.startsWith("__reactContainer$"),
				),
			) || 0),
		0,
	);
}

export function installHeadlessRuntimeProbe(args: {
	host: ProbeHost;
	environment: ProbeEnvironment;
	buildMarker: string;
	entry: string;
}): HeadlessRuntimeProbeController {
	const scope = globalThis as unknown as MutableRecord;
	const globalCalls: CallCounts = {
		timeouts: 0,
		intervals: 0,
		animationFrames: 0,
		workers: 0,
		audioContexts: 0,
		audioContextConstructions: 0,
		webkitAudioContextConstructions: 0,
		objectUrls: 0,
		webGpuAdapterRequests: 0,
		wasmInstantiations: 0,
		wasmInstantiateCalls: 0,
		wasmInstantiateStreamingCalls: 0,
	};
	const hostCalls: HostCallCounts = {
		workers: 0,
		audioContexts: 0,
		objectUrls: 0,
		graphicsQueries: 0,
	};
	const restorers: Array<() => void> = [];
	const globalHooks: HeadlessRuntimeHookObservation[] = [];
	const hostHooks: HeadlessRuntimeHookObservation[] = [];
	const reactHooks: HeadlessRuntimeHookObservation[] = [];
	const events: Array<{
		sequence: number;
		kind: HeadlessRuntimeProbeSnapshot["events"][number]["kind"];
	}> = [];
	let sequence = 0;
	let hostBinding: HeadlessHostBindingObservation | null = null;
	let hostResourceState: HeadlessRuntimeProbeSnapshot["hostResourceState"] =
		null;
	let finished: HeadlessRuntimeProbeSnapshot | null = null;
	let mutationRecords = 0;
	let observer: MutationObserver | null = null;
	let browserDocument: Document | null = null;
	let rootMarkersBefore = 0;

	const event = (
		kind: HeadlessRuntimeProbeSnapshot["events"][number]["kind"],
	) => {
		events.push({ sequence: (sequence += 1), kind });
	};

	const replaceCallable = ({
		target,
		key,
		path,
		onCall,
	}: {
		target: MutableRecord | null | undefined;
		key: string;
		path: string;
		onCall: () => void;
	}): HeadlessRuntimeHookObservation => {
		if (!target) {
			return {
				path,
				status: "absent",
				detail: `${path} owner is absent`,
			};
		}
		const original = target[key];
		if (typeof original !== "function") {
			return {
				path,
				status: "absent",
				detail: `typeof ${path} is ${typeof original}`,
			};
		}
		const descriptor = Object.getOwnPropertyDescriptor(target, key);
		const wrapped = new Proxy(original, {
			apply(callable, thisArgument, values) {
				onCall();
				return Reflect.apply(callable, thisArgument, values);
			},
			construct(callable, values, newTarget) {
				onCall();
				return Reflect.construct(callable, values, newTarget);
			},
		});
		try {
			Object.defineProperty(target, key, {
				configurable: true,
				enumerable: descriptor?.enumerable ?? false,
				writable: true,
				value: wrapped,
			});
		} catch {
			return {
				path,
				status: "unpatchable",
				detail: `${path} exists but cannot be wrapped`,
			};
		}
		restorers.push(() => {
			if (descriptor) Object.defineProperty(target, key, descriptor);
			else Reflect.deleteProperty(target, key);
		});
		return { path, status: "installed", detail: `${path} wrapped` };
	};

	globalHooks.push(
		replaceCallable({
			target: scope,
			key: "setTimeout",
			path: "globalThis.setTimeout",
			onCall: () => (globalCalls.timeouts += 1),
		}),
	);
	globalHooks.push(
		replaceCallable({
			target: scope,
			key: "setInterval",
			path: "globalThis.setInterval",
			onCall: () => (globalCalls.intervals += 1),
		}),
	);
	globalHooks.push(
		replaceCallable({
			target: scope,
			key: "requestAnimationFrame",
			path: "globalThis.requestAnimationFrame",
			onCall: () => (globalCalls.animationFrames += 1),
		}),
	);
	globalHooks.push(
		replaceCallable({
			target: scope,
			key: "Worker",
			path: "globalThis.Worker",
			onCall: () => (globalCalls.workers += 1),
		}),
	);
	globalHooks.push(
		replaceCallable({
			target: scope,
			key: "AudioContext",
			path: "globalThis.AudioContext",
			onCall: () => {
				globalCalls.audioContexts += 1;
				globalCalls.audioContextConstructions += 1;
			},
		}),
	);
	globalHooks.push(
		replaceCallable({
			target: scope,
			key: "webkitAudioContext",
			path: "globalThis.webkitAudioContext",
			onCall: () => {
				globalCalls.audioContexts += 1;
				globalCalls.webkitAudioContextConstructions += 1;
			},
		}),
	);
	globalHooks.push(
		replaceCallable({
			target:
				typeof URL === "function"
					? (URL as unknown as MutableRecord)
					: undefined,
			key: "createObjectURL",
			path: "URL.createObjectURL",
			onCall: () => (globalCalls.objectUrls += 1),
		}),
	);
	const navigator = scope.navigator as { gpu?: MutableRecord } | undefined;
	globalHooks.push(
		replaceCallable({
			target: args.environment === "browser" ? navigator?.gpu : undefined,
			key: "requestAdapter",
			path: "navigator.gpu.requestAdapter",
			onCall: () => {
				globalCalls.webGpuAdapterRequests += 1;
			},
		}),
	);
	const wasm =
		typeof WebAssembly === "object"
			? (WebAssembly as unknown as MutableRecord)
			: undefined;
	globalHooks.push(
		replaceCallable({
			target: wasm,
			key: "instantiate",
			path: "WebAssembly.instantiate",
			onCall: () => {
				globalCalls.wasmInstantiations += 1;
				globalCalls.wasmInstantiateCalls += 1;
			},
		}),
	);
	globalHooks.push(
		replaceCallable({
			target: wasm,
			key: "instantiateStreaming",
			path: "WebAssembly.instantiateStreaming",
			onCall: () => {
				globalCalls.wasmInstantiations += 1;
				globalCalls.wasmInstantiateStreamingCalls += 1;
			},
		}),
	);

	if (args.environment === "browser") {
		browserDocument = scope.document as Document;
		rootMarkersBefore = countReactRootMarkers(browserDocument);
		reactHooks.push({
			path: "document.reactRootMarkers",
			status: "installed",
			detail: "document root-marker scan installed",
		});
		const Observer = scope.MutationObserver as typeof MutationObserver;
		if (typeof Observer === "function") {
			observer = new Observer((records) => {
				mutationRecords += records.length;
			});
			observer.observe(browserDocument.documentElement, {
				childList: true,
				characterData: true,
				subtree: true,
			});
			reactHooks.push({
				path: "globalThis.MutationObserver",
				status: "installed",
				detail: "MutationObserver is observing document.documentElement",
			});
		} else {
			reactHooks.push({
				path: "globalThis.MutationObserver",
				status: "absent",
				detail: `typeof globalThis.MutationObserver is ${typeof Observer}`,
			});
		}
	} else {
		reactHooks.push(
			{
				path: "document.reactRootMarkers",
				status: "absent",
				detail: `${args.environment} environment has no DOM document`,
			},
			{
				path: "globalThis.MutationObserver",
				status: "absent",
				detail: `${args.environment} environment has no DOM MutationObserver`,
			},
		);
	}

	event("probe-installed");

	return {
		markSubjectLoadStarted() {
			if (events.some((entry) => entry.kind === "subject-load-started")) {
				throw new Error("C7 runtime probe subject load was marked twice");
			}
			event("subject-load-started");
		},
		bindHost({
			host,
			intendedStore,
			intendedStoreIdentity,
			expectedProjectId,
		}) {
			if (!events.some((entry) => entry.kind === "subject-load-started")) {
				throw new Error("C7 runtime probe Host bound before subject load");
			}
			if (hostBinding) throw new Error("C7 runtime probe Host bound twice");
			const sameStoreInstance = host.store === intendedStore;
			hostBinding = {
				source: "fixture-explicit-createInMemoryHost",
				expectedProjectId,
				actualProjectId: host.projectId,
				projectMatches: host.projectId === expectedProjectId,
				intendedStoreIdentity,
				actualStoreIdentity: sameStoreInstance
					? intendedStoreIdentity
					: constructorIdentity(host.store),
				sameStoreInstance,
				fallbackUsed: !sameStoreInstance,
			};
			const resources = host.runtimeResources as unknown as MutableRecord;
			hostHooks.push(
				replaceCallable({
					target: resources,
					key: "createWorker",
					path: "host.runtimeResources.createWorker",
					onCall: () => (hostCalls.workers += 1),
				}),
				replaceCallable({
					target: resources,
					key: "createAudioContext",
					path: "host.runtimeResources.createAudioContext",
					onCall: () => (hostCalls.audioContexts += 1),
				}),
				replaceCallable({
					target: resources,
					key: "createObjectUrl",
					path: "host.runtimeResources.createObjectUrl",
					onCall: () => (hostCalls.objectUrls += 1),
				}),
				replaceCallable({
					target: host.environment as unknown as MutableRecord,
					key: "describeGraphics",
					path: "host.environment.describeGraphics",
					onCall: () => (hostCalls.graphicsQueries += 1),
				}),
			);
			event("host-bound");
			return hostBinding;
		},
		recordHostResourceState(value) {
			hostResourceState = { ...value };
		},
		finish() {
			if (finished) return finished;
			event("subject-completed");
			if (observer) {
				mutationRecords += observer.takeRecords().length;
				observer.disconnect();
			}
			const rootMarkersAfter = browserDocument
				? countReactRootMarkers(browserDocument)
				: 0;
			for (const restore of restorers.reverse()) restore();
			event("probe-restored");
			const markerAttempts = Math.max(0, rootMarkersAfter - rootMarkersBefore);
			const ownershipAttempts =
				hostCalls.graphicsQueries +
				globalCalls.webGpuAdapterRequests +
				globalCalls.wasmInstantiations;
			finished = {
				schemaVersion: 1,
				implementation: "headless-runtime-probe/v1",
				probeId: `c7-runtime-probe:${args.host}:${args.buildMarker}:${args.entry}`,
				host: args.host,
				environment: args.environment,
				buildMarker: args.buildMarker,
				entry: args.entry,
				events: events.map((entry) => ({ ...entry })),
				hostBinding,
				globalCalls: { ...globalCalls },
				hostCalls: { ...hostCalls },
				hookProvenance: {
					global: {
						strategy: "pre-load-callable-proxy/v1",
						hooks: globalHooks.map((hook) => ({ ...hook })),
					},
					host: {
						strategy: "post-bind-host-callable-proxy/v1",
						hooks: hostHooks.map((hook) => ({ ...hook })),
					},
					react: {
						strategy: browserDocument
							? "browser-mutation-observer+root-marker-scan/v1"
							: "server-no-dom/v1",
						hooks: reactHooks.map((hook) => ({ ...hook })),
					},
					compositorGpu: {
						strategy: "derived-host-webgpu-wasm/v1",
						fields: [
							"hostGraphicsQueries",
							"webGpuAdapterRequests",
							"wasmInstantiations",
							"ownershipAttempts",
						],
					},
				},
				hostResourceState,
				react: {
					strategy: browserDocument
						? "mutation-observer+react-container-markers"
						: "server-no-dom",
					domAvailable: browserDocument !== null,
					mutationRecords,
					rootMarkersBefore,
					rootMarkersAfter,
					mountAttempts: mutationRecords + markerAttempts,
				},
				compositorGpu: {
					strategy: "host-graphics+webgpu+wasm-construction",
					hostGraphicsQueries: hostCalls.graphicsQueries,
					webGpuAdapterRequests: globalCalls.webGpuAdapterRequests,
					wasmInstantiations: globalCalls.wasmInstantiations,
					ownershipAttempts,
				},
			};
			return finished;
		},
	};
}
