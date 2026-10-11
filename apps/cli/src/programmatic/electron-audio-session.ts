import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ElectronNativeVideoCallback } from "./electron-native-video-server";
import { ELECTRON_NATIVE_VIDEO_PROTOCOL } from "./electron-native-video-server";
import { ELECTRON_NATIVE_AUDIO_PROTOCOL } from "./electron-audio-transport";

export const ELECTRON_AUDIO_SESSION_PROTOCOL = "html-frames-native-audio-session-v1";
const MAX_REQUEST_BYTES = 96 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_RESPONSE_BYTES = 32 * 1024 * 1024;

export interface ElectronAudioBrowserIdentity {
	readonly product: string;
	readonly revision: string;
	readonly jsVersion: string;
	readonly protocolVersion: string;
}

export interface ElectronProducedCaptureCallback {
	version: 1;
	endpoint: string;
	token: string;
	maxSourceBytes: number;
	maxTotalBytes: number;
	durationFrames: number;
}

/** Backend-only credential pinning. A source session cannot inherit PNG access. */
export function pinElectronAudioSessionConnection(connectionFile: string, nativeVideo = false) {
	try {
		if (!isAbsolute(connectionFile)) throw Error();
		const fd = openSync(connectionFile, "r");
		let value;
		try {
			const stat = fstatSync(fd);
			if (!stat.isFile() || stat.size > 4096) throw Error();
			const bytes = Buffer.alloc(4097);
			const length = readSync(fd, bytes, 0, bytes.length, 0);
			if (length > 4096) throw Error();
			value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
		} finally { closeSync(fd); }
		const endpoint = new URL(value.endpoint);
		const capabilities = value.capabilities;
		if (value.version !== 1 || value.backend !== "elftia-electron" ||
			endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" ||
			!endpoint.port || endpoint.pathname !== "/v1/frame" ||
			endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
			typeof value.token !== "string" || !/^[a-f0-9]{64}$/.test(value.token) ||
			capabilities?.nativeAudioAnalysis?.version !== 1 ||
			capabilities.nativeAudioAnalysis.protocol !== ELECTRON_NATIVE_AUDIO_PROTOCOL ||
			capabilities?.nativeAudioSession?.version !== 1 ||
			capabilities.nativeAudioSession.protocol !== ELECTRON_AUDIO_SESSION_PROTOCOL ||
			(nativeVideo && (capabilities?.nativeVideoCapture?.version !== 1 ||
				capabilities.nativeVideoCapture.protocol !== ELECTRON_NATIVE_VIDEO_PROTOCOL))) throw Error();
		endpoint.pathname = "/v1/audio-sessions";
		return Object.freeze({ endpoint: endpoint.href, token: value.token as string });
	} catch {
		throw Error("Elftia Electron native audio session grant is unavailable");
	}
}

async function post(connection: ReturnType<typeof pinElectronAudioSessionConnection>, route: string,
	body: object, signal: AbortSignal, maxBytes: number): Promise<Record<string, unknown>> {
	signal.throwIfAborted();
	const encoded = JSON.stringify(body);
	if (Buffer.byteLength(encoded) > MAX_REQUEST_BYTES) throw Error("Electron audio session request exceeds transport limit");
	let response: Response;
	try {
		response = await fetch(connection.endpoint + route, { method: "POST", redirect: "error", signal,
			headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" }, body: encoded });
	} catch {
		throw Error(signal.aborted ? "Electron audio session cancelled or timed out" : "Electron audio session connection failed");
	}
	if (!response.ok || response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
		await response.body?.cancel();
		throw Error(`Elftia Electron audio session failed (HTTP ${response.status})`);
	}
	const reader = response.body?.getReader();
	if (!reader) throw Error("Electron audio session returned no result");
	const chunks: Buffer[] = []; let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read(); if (done) break;
			size += value.length;
			if (size > maxBytes) throw Error("Electron audio session response exceeds transport limit");
			chunks.push(Buffer.from(value));
		}
	} finally { await reader.cancel(); }
	let result;
	try { result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
	catch { throw Error("Electron audio session returned invalid JSON"); }
	if (!result || typeof result !== "object" || Array.isArray(result) || result.version !== 1)
		throw Error("Electron audio session returned an invalid result envelope");
	signal.throwIfAborted();
	return result;
}

function browserIdentity(value: unknown): ElectronAudioBrowserIdentity {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid Electron audio browser identity");
	const record = value as Record<string, unknown>;
	const fields = ["product", "revision", "jsVersion", "protocolVersion"] as const;
	for (const field of fields) {
		if (typeof record[field] !== "string" || !record[field].length || record[field].length > 512 ||
			/[\u0000-\u001f\u007f]/.test(record[field])) throw Error("Invalid Electron audio browser identity");
	}
	return Object.freeze({ product: record.product as string, revision: record.revision as string,
		jsVersion: record.jsVersion as string, protocolVersion: record.protocolVersion as string });
}

async function closeOpenedSession(connection: ReturnType<typeof pinElectronAudioSessionConnection>, id: string) {
	const result = await post(connection, `/${id}/close`, { version: 1 }, AbortSignal.timeout(5000), MAX_RESPONSE_BYTES);
	if (result.closed !== true || Object.keys(result).some(key => key !== "version" && key !== "closed"))
		throw Error("Electron audio session returned an invalid close receipt");
}

/** Semantic session API only; no browser attachment, raw CDP or external fallback. */
export async function openElectronAudioSession({ connectionFile, profile, width, height, signal, nativeVideo, producedCapture }: {
	connectionFile: string; profile: "source" | "dsp"; width: number; height: number; signal: AbortSignal;
	nativeVideo?: ElectronNativeVideoCallback; producedCapture?: ElectronProducedCaptureCallback;
}) {
	signal.throwIfAborted();
	if (![width, height].every(value => Number.isInteger(value) && value >= 1 && value <= 4096) ||
		(profile !== "source" && profile !== "dsp")) throw Error("Invalid Electron audio session profile or dimensions");
	const connection = pinElectronAudioSessionConnection(connectionFile, !!nativeVideo);
	const opened = await post(connection, "/open", { version: 1, profile, width, height,
		...(nativeVideo ? { nativeVideo } : {}), ...(producedCapture ? { producedCapture } : {}) },
		AbortSignal.any([signal, AbortSignal.timeout(30000)]), MAX_RESPONSE_BYTES);
	if (typeof opened.sessionId !== "string" || !/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(opened.sessionId))
		throw Error("Invalid Electron audio session identity");
	const id = opened.sessionId;
	let epoch: string, browser: ElectronAudioBrowserIdentity;
	try {
		if (typeof opened.epoch !== "string" || !/^[a-f0-9]{32}$/.test(opened.epoch))
			throw Error("Invalid Electron audio session identity");
		epoch = opened.epoch;
		browser = browserIdentity(opened.browser);
	} catch (error) {
		// Only a complete safe identifier can address cleanup; invalid metadata
		// must not leak a session that the Host already successfully allocated.
		await closeOpenedSession(connection, id).catch(() => {});
		throw error;
	}
	const stopped = new AbortController();
	let closing: Promise<void> | undefined, busy = false;
	const close = (): Promise<void> => closing ??= (async () => {
		signal.removeEventListener("abort", abort);
		stopped.abort(Error("Electron audio session closed"));
		// Cleanup must remain possible after the caller's job has been cancelled.
		await closeOpenedSession(connection, id);
	})();
	const abort = () => { void close().catch(() => {}); };
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) { await close().catch(() => {}); signal.throwIfAborted(); }
	return Object.freeze({ browser, epoch,
		async evaluate(expression: string, { timeoutMs = 15000 }: { timeoutMs?: number } = {}): Promise<unknown> {
			if (closing || busy) throw Error("Electron audio session is closed or busy");
			if (typeof expression !== "string" || !expression.length || !Number.isSafeInteger(timeoutMs) ||
				timeoutMs < 1 || timeoutMs > 1800000) throw Error("Invalid Electron audio session evaluation");
			busy = true;
			try {
				const value = await post(connection, `/${id}/evaluate`, { version: 1, expression, timeoutMs },
					AbortSignal.any([signal, stopped.signal, AbortSignal.timeout(timeoutMs + 1000)]),
					profile === "source" ? MAX_SOURCE_RESPONSE_BYTES : MAX_RESPONSE_BYTES);
				if (!Object.hasOwn(value, "value") || Object.keys(value).some(key => key !== "version" && key !== "value"))
					throw Error("Electron audio session returned an invalid observation envelope");
				return value.value;
			} catch (error) {
				await close().catch(() => {});
				throw error;
			} finally { busy = false; }
		}, close,
	});
}
