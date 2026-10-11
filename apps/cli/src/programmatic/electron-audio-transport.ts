import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";
import { ELECTRON_NATIVE_VIDEO_PROTOCOL, type ElectronNativeVideoCallback } from "./electron-native-video-server";

export const ELECTRON_NATIVE_AUDIO_PROTOCOL = "html-frames-native-audio-v1";

/** A descriptor is an independent named grant, never inferred from PNG access. */
export function pinElectronAudioConnection(connectionFile: string, nativeVideo = false) {
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
		if (value.version !== 1 || value.backend !== "elftia-electron" ||
			endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" ||
			!endpoint.port || endpoint.pathname !== "/v1/frame" ||
			endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
			typeof value.token !== "string" || !/^[a-f0-9]{64}$/.test(value.token) ||
			value.capabilities?.nativeAudioAnalysis?.version !== 1 ||
			value.capabilities.nativeAudioAnalysis.protocol !== ELECTRON_NATIVE_AUDIO_PROTOCOL ||
			(nativeVideo && (value.capabilities?.nativeVideoCapture?.version !== 1 ||
			value.capabilities.nativeVideoCapture.protocol !== ELECTRON_NATIVE_VIDEO_PROTOCOL))) throw Error();
		endpoint.pathname = "/v1/audio-analysis";
		return Object.freeze({ endpoint: endpoint.href, token: value.token as string });
	} catch { throw Error("Elftia Electron native audio analysis grant is unavailable"); }
}

export async function analyzeElectronAudio({ connectionFile, width, height, expression, nativeVideo, signal }: {
	connectionFile: string; width: number; height: number; expression: string;
	nativeVideo?: ElectronNativeVideoCallback; signal: AbortSignal;
}): Promise<unknown> {
	signal.throwIfAborted();
	const connection = pinElectronAudioConnection(connectionFile, !!nativeVideo);
	const lifetime = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
	let response: Response;
	try {
		response = await fetch(connection.endpoint, { method: "POST", redirect: "error", signal: lifetime,
			headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
			body: JSON.stringify({ version: 1, width, height, expression, ...(nativeVideo ? { nativeVideo } : {}) }) });
	} catch { throw Error(lifetime.aborted ? "Electron audio analysis cancelled or timed out" : "Electron audio analysis connection failed"); }
	if (!response.ok || response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
		await response.body?.cancel();
		throw Error(`Elftia Electron audio analysis failed (HTTP ${response.status})`);
	}
	const reader = response.body?.getReader();
	if (!reader) throw Error("Electron audio analysis returned no observation");
	let size = 0; const chunks: Buffer[] = [];
	try {
		for (;;) {
			const { done, value } = await reader.read(); if (done) break;
			size += value.length;
			if (size > 2 * 1024 * 1024) throw Error("Electron audio observation exceeds the transport limit");
			chunks.push(Buffer.from(value));
		}
	} finally { await reader.cancel(); }
	let envelope;
	try { envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
	catch { throw Error("Electron audio analysis returned an invalid JSON observation"); }
	if (!envelope || envelope.version !== 1 || !Object.hasOwn(envelope, "value") ||
		Object.keys(envelope).some(key => key !== "version" && key !== "value"))
		throw Error("Electron audio analysis returned an invalid observation envelope");
	signal.throwIfAborted();
	return envelope.value;
}
