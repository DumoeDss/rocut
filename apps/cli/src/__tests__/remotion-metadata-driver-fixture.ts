import { transformSync } from "esbuild";
import { REMOTION_FRAME_DRIVER } from "../programmatic/engines/remotion-driver";
import { REMOTION_INSPECTION_DRIVER } from "../programmatic/remotion-inspection-driver";
import { createRemotionMetadataLifetime } from "../programmatic/remotion-metadata-lifetime";
import { REMOTION_METADATA_POLICY_SOURCE } from "../programmatic/remotion-metadata-policy";
import {
	createRemotionMetadataReceipt,
	remotionMetadataJsonSha256,
} from "../programmatic/remotion-metadata-receipt";

interface Metadata {
	width: number;
	height: number;
	fps: number;
	durationInFrames: number;
	props: unknown;
}
interface Node {
	type: unknown;
	parameters: { children: unknown; [key: string]: unknown };
}
export function metadataDriverFixture({
	inspection = false,
	props = { color: "red", list: [1, 2] },
	timeoutMs = 80,
	nativeCommit = "immediate",
	paint = (callback: () => void) => queueMicrotask(callback),
	now = () => performance.now(),
	resolve = async () => ({
		width: 64,
		height: 32,
		fps: 30,
		durationInFrames: 10,
		props,
	}),
}: {
	inspection?: boolean;
	props?: Record<string, unknown>;
	timeoutMs?: number;
	nativeCommit?: "immediate" | "manual";
	paint?: (callback: () => void) => unknown;
	now?: () => number;
	resolve?: (input: Record<string, unknown>) => Promise<Metadata>;
} = {}) {
	const inputProps = { supplied: 3 };
	const spec = {
		compositionId: "Main",
		inputProps,
		width: 64,
		height: 32,
		durationFrames: 10,
		frameRate: { numerator: 30, denominator: 1 },
	};
	const binding = {
		...spec,
		inputProps: undefined,
		adapter: {
			id: "rocut-remotion-html" as const,
			version: 2 as const,
			sha256: "a".repeat(64),
		},
		inspectionRevision: "b".repeat(64),
		toolchainLockSha256: "c".repeat(64),
		inputPropsSha256: remotionMetadataJsonSha256(inputProps),
	};
	delete binding.inputProps;
	const receipt = createRemotionMetadataReceipt({
		binding,
		returnedProps: props,
	});
	const policy = {
		profile: "metadata-pinned-v1",
		adapter: binding.adapter,
		binding,
		receipt,
	};
	const createPolicy: unknown = new Function(
		REMOTION_METADATA_POLICY_SOURCE +
			"\nreturn ({spec,policy})=>rocutCreateRemotionMetadataPolicy({spec,policy,canonical:rocutCanonicalRemotionMetadataJson,validation:rocutRemotionMetadataValidation});",
	)();
	if (typeof createPolicy !== "function")
		throw Error("Metadata policy fixture missing");
	const state = {
		unmounts: 0,
		removed: 0,
		releases: 0,
		selections: 0,
		renderedMetadata: [] as unknown[],
		calls: [] as Record<string, unknown>[],
	};
	const listeners = new Map<string, () => void>();
	const window: Record<string, unknown> = {
		__rocutRemotionSpec: spec,
		__rocutRemotionMetadataPolicy: createPolicy({ spec, policy }),
		__rocutRemotionLifetimeFactory: (options: { check: () => void }) =>
			createRemotionMetadataLifetime({ ...options, timeoutMs }),
		remotion_delayRenderHandles: [],
		remotion_renderReady: true,
		remotion_cancelledError: undefined as string | undefined,
		rocutMedia: { check() {} },
	};
	const passthrough = ({ children }: { children: unknown }) => children;
	let notifyCommit: ((id: string) => () => void) | undefined;
	let nativeCleanup: (() => void) | undefined;
	let rejectNative: ((error: Error) => void) | undefined;
	const commit = (id = "Main") => {
		nativeCleanup = notifyCommit?.(id);
	};
	const NativeCompositionCommitContext = {
		Provider: ({
			value,
			children,
		}: {
			value: typeof notifyCommit;
			children: unknown;
		}) => {
			notifyCommit = value;
			return children;
		},
	};
	const Manager = (parameters: {
		children: unknown;
		currentCompositionMetadata: unknown;
	}) => {
		state.renderedMetadata.push(parameters.currentCompositionMetadata);
		return parameters.children;
	};
	class Component {
		props: Record<string, unknown>;
		constructor(parameters: Record<string, unknown>) {
			this.props = parameters;
		}
	}
	const React = {
		Component,
		createElement: (
			...[type, parameters, ...children]: [
				unknown,
				Record<string, unknown>,
				...unknown[],
			]
		) => ({ type, parameters: { ...parameters, children } }),
		useContext: () => ({
			setCanvasContent: () => {
				state.selections++;
				if (nativeCommit === "immediate") commit();
			},
		}),
		useLayoutEffect: (callback: () => void) => callback(),
	};
	const isNode = (value: unknown): value is Node =>
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		"parameters" in value &&
		typeof value.parameters === "object" &&
		value.parameters !== null &&
		"children" in value.parameters;
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			value.forEach(visit);
			return;
		}
		if (!isNode(value)) return;
		const node = value;
		if (typeof node.type === "function") {
			if (node.type.prototype instanceof Component) {
				const instance: unknown = Reflect.construct(node.type, [
					node.parameters,
				]);
				if (
					typeof instance !== "object" ||
					instance === null ||
					!("render" in instance) ||
					typeof instance.render !== "function"
				)
					throw Error("Invalid fixture component");
				if (
					"componentDidCatch" in instance &&
					typeof instance.componentDidCatch === "function"
				) {
					const catchNative = instance.componentDidCatch;
					rejectNative = (error) =>
						Reflect.apply(catchNative, instance, [error]);
				}
				visit(instance.render());
			} else visit(node.type(node.parameters));
		}
	};
	const composition = {
		id: "Main",
		width: 64,
		height: 32,
		fps: 30,
		durationInFrames: 10,
		defaultProps: { defaultValue: 4 },
	};
	const Internals = {
		getRoot: () => () => null,
		RemotionRootContexts: passthrough,
		CompositionManagerProvider: Manager,
		RenderAssetManager: { Provider: passthrough },
		CompositionSetters: {},
		portalNode: () => ({}),
		compositionsRef: { current: { getCompositions: () => [composition] } },
		resolveVideoConfig: (parameters: Record<string, unknown>) => {
			state.calls.push(parameters);
			return resolve(parameters);
		},
	};
	const modules: Record<string, unknown> = {
		react: React,
		"react-dom/client": {
			createRoot: () => ({
				render: visit,
				unmount: () => {
					nativeCleanup?.();
					state.unmounts++;
				},
			}),
		},
		"react-dom": { flushSync: (callback: () => void) => callback() },
		remotion: {
			Internals,
			__rocutCompositionCommitContext: NativeCompositionCommitContext,
			getInputProps: () => inputProps,
			delayRender: () => 1,
			continueRender: () => {
				state.releases++;
			},
		},
		"rocut:entry": {},
	};
	const document = {
		body: { appendChild() {} },
		createElement: () => ({
			remove: () => {
				state.removed++;
			},
		}),
		querySelector: () => null,
	};
	// Only shorten the native inspection deadline in this CPU realm. The emitted
	// lifetime implementation and all wait/abort/validation paths remain genuine.
	const driver = inspection
		? REMOTION_INSPECTION_DRIVER.replace(
				"timeoutMs:8000",
				`timeoutMs:${timeoutMs}`,
			)
		: REMOTION_FRAME_DRIVER;
	const code = transformSync(driver, {
		loader: "tsx",
		format: "cjs",
		target: "esnext",
	}).code;
	new Function(
		"require",
		"window",
		"document",
		"requestAnimationFrame",
		"addEventListener",
		"removeEventListener",
		"performance",
		code,
	)(
		(name: string) => modules[name],
		window,
		document,
		paint,
		(name: string, callback: () => void) => listeners.set(name, callback),
		(name: string) => listeners.delete(name),
		{ now },
	);
	return {
		state,
		window,
		spec,
		receipt,
		listeners,
		commit,
		uncommit: () => nativeCleanup?.(),
		rejectNative: (error: Error) => rejectNative?.(error),
		run: () => {
			const method =
				window[
					inspection ? "__rocutInspectRemotion" : "__rocutRenderRemotionFrame"
				];
			if (typeof method !== "function")
				throw Error("Emitted driver fixture method missing");
			return inspection
				? method()
				: method({ index: 0, frameRate: spec.frameRate });
		},
		teardown: () => listeners.get("pagehide")?.(),
	};
}
