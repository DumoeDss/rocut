import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { isAbsolute } from "node:path";
import { launchFrameBrowser } from "./chromium-process";
import { openElectronAudioSession } from "./electron-audio-session";
import {
	loadHyperframesFxRuntime,
	hyperframesFxDigest,
} from "./hyperframes-fx-runtime";
import type { HyperframesFxProvenance } from "./hyperframes-fx-types";
import { hyperframesGraphDecoderIdentity } from "./hyperframes-graph-file-identity";
import {
	HYPERFRAMES_GRAPH_PROFILE,
	verifyHyperframesGraphArchive,
} from "./hyperframes-graph-provenance";
import type { ProgrammaticResourceStore } from "./resources";
import { hyperframesGraphTimingIdentity } from "./hyperframes-graph-timing";
import type { NativeVideoDecoder } from "./video-decoder";

export interface HyperframesGraphIdentity {
	readonly version: 1;
	readonly profile: typeof HYPERFRAMES_GRAPH_PROFILE;
	readonly id: string;
}

/** Actual process-reported runtime tuple, not a hash/attestation of chrome.exe
 * (which can merely launch chrome.dll). Trusted local installation is required. */
export function hyperframesGraphBrowserIdentity(
	value: Record<string, unknown>,
): HyperframesFxProvenance["browser"] {
	const fields = [
		"product",
		"revision",
		"jsVersion",
		"protocolVersion",
	] as const;
	for (const field of fields) {
		const entry = value[field];
		if (
			typeof entry !== "string" ||
			!entry.length ||
			entry.length > 512 ||
			/[\u0000-\u001f\u007f]/.test(entry)
		)
			throw Error("Invalid actual HyperFrames browser runtime identity");
	}
	return Object.freeze({
		product: value.product as string,
		revision: value.revision as string,
		jsVersion: value.jsVersion as string,
		protocolVersion: value.protocolVersion as string,
	});
}

async function probeBrowser(executable: string | undefined, signal: AbortSignal, connectionFile?: string) {
	if (!connectionFile && (!executable || !isAbsolute(executable)))
		throw Error(
			"Graph browser identity requires a configured absolute executable path",
		);
	const deadline = new AbortController();
	const lifetime = AbortSignal.any([signal, deadline.signal]);
	const timer = setTimeout(
		() => deadline.abort(Error("Graph browser identity probe timed out")),
		15000,
	);
	try {
		if (connectionFile) {
			const session = await openElectronAudioSession({ connectionFile, profile: "dsp", width: 64, height: 64, signal: lifetime });
			try { lifetime.throwIfAborted(); return { browser: hyperframesGraphBrowserIdentity({ ...session.browser }), electronHostEpoch: session.epoch }; }
			finally { await session.close(); }
		}
		const browser = await launchFrameBrowser(executable!, lifetime);
		try {
			const result = hyperframesGraphBrowserIdentity(
				await browser.send("Browser.getVersion"),
			);
			lifetime.throwIfAborted();
			return { browser: result, electronHostEpoch: undefined };
		} finally {
			await browser.close();
		}
	} finally {
		clearTimeout(timer);
	}
}

export function assertHyperframesGraphProvenance(
	actual: HyperframesFxProvenance,
	expected: HyperframesFxProvenance,
): void {
	const keys = [
		"electronHostEpoch",
		"nativeVersion",
		"runtimeSha256",
		"moduleSha256",
		"packageLockSha256",
		"packageIntegrity",
		"adapterVersion",
		"adapterSha256",
	] as const;
	if (
		!actual ||
		keys.some((key) => actual[key] !== expected[key]) ||
		!actual.browser ||
		Object.entries(expected.browser).some(
			([key, value]) =>
				actual.browser[key as keyof typeof actual.browser] !== value,
		)
	)
		throw Error(
			"HyperFrames graph runtime identity changed; request a fresh identity",
		);
}

/** Source/archive descriptors belong in the caller's cache key separately. The
 * Host nonce partitions a fixed process/kernel epoch and is NEVER returned.
 * Preflight has real IO cost: no pathname or metadata-only cache shortcuts. */
export async function prepareHyperframesGraphIdentity({
	source,
	resourceStore,
	toolchainDirectory,
	executable,
	connectionFile,
	decoder,
	sessionNonce,
	signal,
}: {
	source: ProgrammaticSource;
	resourceStore: ProgrammaticResourceStore;
	toolchainDirectory: string;
	executable?: string;
	connectionFile?: string;
	decoder: NativeVideoDecoder;
	sessionNonce: string;
	signal: AbortSignal;
}) {
	signal.throwIfAborted();
	if (
		typeof sessionNonce !== "string" ||
		sessionNonce.length < 16 ||
		sessionNonce.length > 256 ||
		/[\u0000-\u001f\u007f]/.test(sessionNonce)
	)
		throw Error("Invalid Host graph identity epoch");
	// These internal selectors are not part of the public identity response.
	const selectedDecoder = Object.freeze({
		ffmpeg: decoder.ffmpeg,
		ffprobe: decoder.ffprobe,
	});
	const selectedSource = JSON.parse(
		JSON.stringify(source),
	) as ProgrammaticSource;
	const runtime = await loadHyperframesFxRuntime({
		toolchainDirectory,
		signal,
	});
	const compileIdentity = await verifyHyperframesGraphArchive({
		source: selectedSource,
		resourceStore,
		runtime,
		signal,
	});
	const decoderIdentity = await hyperframesGraphDecoderIdentity(
		selectedDecoder,
		signal,
	);
	const browserProbe = await probeBrowser(executable, signal, connectionFile);
	const browser = browserProbe.browser;
	const provenance: HyperframesFxProvenance = Object.freeze({
		...(browserProbe.electronHostEpoch ? { electronHostEpoch: browserProbe.electronHostEpoch } : {}),
		nativeVersion: compileIdentity.nativeVersion,
		runtimeSha256: compileIdentity.runtimeSha256,
		moduleSha256: compileIdentity.moduleSha256,
		packageLockSha256: compileIdentity.packageLockSha256,
		packageIntegrity: compileIdentity.packageIntegrity,
		adapterVersion: compileIdentity.adapterVersion,
		adapterSha256: compileIdentity.adapterSha256,
		browser,
	});
	const identity: HyperframesGraphIdentity = Object.freeze({
		version: 1,
		profile: HYPERFRAMES_GRAPH_PROFILE,
		id: hyperframesFxDigest(
			JSON.stringify({
				version: 1,
				profile: HYPERFRAMES_GRAPH_PROFILE,
				sessionNonce,
				provenance,
				decoderIdentity,
				...hyperframesGraphTimingIdentity(compileIdentity.timing),
			}),
		),
	});
	const verifyDecoder = async (verificationSignal: AbortSignal = signal) => {
		const lifetime = AbortSignal.any([signal, verificationSignal]);
		const current = await hyperframesGraphDecoderIdentity(
			selectedDecoder,
			lifetime,
		);
		if (JSON.stringify(current) !== JSON.stringify(decoderIdentity))
			throw Error(
				"HyperFrames graph decoder identity changed; request a fresh identity",
			);
		lifetime.throwIfAborted();
	};
	// A decoder upgrade during the browser probe must not bless a stale preflight.
	await verifyDecoder();
	return Object.freeze({
		identity,
		runtime,
		provenance,
		compileIdentity,
		decoder: selectedDecoder,
		verifyBeforeRender: verifyDecoder,
		async verifyAfterRender(
			actualProvenance: HyperframesFxProvenance,
			verificationSignal: AbortSignal = signal,
		) {
			assertHyperframesGraphProvenance(actualProvenance, provenance);
			if (connectionFile) {
				const current = await probeBrowser(undefined, AbortSignal.any([signal, verificationSignal]), connectionFile);
				if (current.electronHostEpoch !== provenance.electronHostEpoch || JSON.stringify(current.browser) !== JSON.stringify(browser))
					throw Error("HyperFrames Electron Host identity changed after render");
			}
			await verifyDecoder(verificationSignal);
		},
	});
}
