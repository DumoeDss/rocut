import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { HYPERFRAMES_FX_ADAPTER } from "./hyperframes-fx-executor";
import {
	assertHyperframesFxRuntime,
	type HyperframesFxRuntime,
} from "./hyperframes-fx-runtime";
import {
	loadProgrammaticResource,
	type ProgrammaticResourceStore,
} from "./resources";

export const HYPERFRAMES_GRAPH_PROFILE = "hyperframes-graph-v1" as const;
export const HYPERFRAMES_GRAPH_SEMANTICS =
	"rocut-hyperframes-0.8.139-audio-graph-v1" as const;

/** Portable compile-time requirement, not a runtime browser identity. No local
 * executable paths, credentials, registry URLs or session nonce are archived. */
export interface HyperframesGraphCompileIdentity {
	readonly version: 1;
	readonly profile: typeof HYPERFRAMES_GRAPH_PROFILE;
	readonly semanticsProfile: typeof HYPERFRAMES_GRAPH_SEMANTICS;
	readonly nativeVersion: "0.8.139";
	readonly runtimeSha256: string;
	readonly moduleSha256: string;
	/** Digest of original package-lock bytes, NOT the sanitized archive lock. */
	readonly packageLockSha256: string;
	readonly packageIntegrity: string;
	readonly adapterVersion: 1;
	readonly adapterSha256: string;
}

export function hasHyperframesGraphProfile(
	source: ProgrammaticSource,
): boolean {
	return (
		(source.audio as { profile?: unknown } | undefined)?.profile ===
		HYPERFRAMES_GRAPH_PROFILE
	);
}

export function hyperframesGraphCompileIdentity(
	runtime: HyperframesFxRuntime,
): HyperframesGraphCompileIdentity {
	assertHyperframesFxRuntime(runtime);
	return Object.freeze({
		version: 1,
		profile: HYPERFRAMES_GRAPH_PROFILE,
		semanticsProfile: HYPERFRAMES_GRAPH_SEMANTICS,
		nativeVersion: runtime.nativeVersion,
		runtimeSha256: runtime.sha256,
		moduleSha256: runtime.moduleSha256,
		packageLockSha256: runtime.packageLockSha256,
		packageIntegrity: runtime.packageIntegrity,
		adapterVersion: HYPERFRAMES_FX_ADAPTER.version,
		adapterSha256: HYPERFRAMES_FX_ADAPTER.sha256,
	});
}

/** A digest in project JSON does not authorize native code. Independently load
 * the trusted local runtime first, then compare this verified archive resource. */
export async function verifyHyperframesGraphArchive({
	source,
	resourceStore,
	runtime,
	signal,
}: {
	source: ProgrammaticSource;
	resourceStore: ProgrammaticResourceStore;
	runtime: HyperframesFxRuntime;
	signal: AbortSignal;
}): Promise<HyperframesGraphCompileIdentity> {
	signal.throwIfAborted();
	if (
		!hasHyperframesGraphProfile(source) ||
		source.audio?.mode !== "native" ||
		source.runtime !== "html-document" ||
		source.build?.engine !== "hyperframes"
	)
		throw Error(
			"HyperFrames graph identity requires an explicitly declared compiled graph source",
		);
	const expected = hyperframesGraphCompileIdentity(runtime);
	const resource = source.build.toolchainLock;
	if (resource.byteLength > 4 * 1024 * 1024)
		throw Error("HyperFrames graph archive lock exceeds the identity limit");
	const archived = await loadProgrammaticResource({
		...resourceStore,
		resource,
		signal,
	});
	let lock: { version?: unknown; audioGraph?: unknown };
	try {
		lock = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(archived.body),
		);
	} catch {
		throw Error("Invalid HyperFrames graph archive lock");
	}
	if (
		!lock ||
		typeof lock !== "object" ||
		Array.isArray(lock) ||
		lock.version !== 1
	)
		throw Error("Invalid HyperFrames graph archive lock");
	const actual = lock.audioGraph;
	if (
		!actual ||
		typeof actual !== "object" ||
		Array.isArray(actual) ||
		Object.keys(actual).length !== Object.keys(expected).length ||
		Object.entries(expected).some(
			([key, value]) => (actual as Record<string, unknown>)[key] !== value,
		)
	)
		throw Error(
			"Archived HyperFrames graph runtime differs; explicitly recompile with the configured runtime",
		);
	signal.throwIfAborted();
	return expected;
}
