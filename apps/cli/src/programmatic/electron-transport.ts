import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ElectronNativeVideoCallback } from "./electron-native-video-server";
import { ELECTRON_NATIVE_VIDEO_PROTOCOL } from "./electron-native-video-server";

/** Backend-only transport. Re-read each frame, so a surviving daemon can use
 * a restarted Elftia. Never put the descriptor/token in catalog or errors. */
export async function captureElectronPng({
	connectionFile,
	width,
	height,
	expression,
	nativeVideo,
	signal,
}: {
	connectionFile: string;
	width: number;
	height: number;
	expression: string;
	nativeVideo?: ElectronNativeVideoCallback;
	signal: AbortSignal;
}): Promise<Buffer> {
	signal.throwIfAborted();
	let endpoint: URL;
	let token: string;
	try {
		if (!isAbsolute(connectionFile)) throw Error();
		const file = await open(connectionFile, "r");
		let value;
		try {
			const stat = await file.stat();
			if (!stat.isFile() || stat.size > 4096) throw Error();
			value = JSON.parse(await file.readFile("utf8"));
		} finally {
			await file.close();
		}
		endpoint = new URL(value.endpoint);
		if (
			value.version !== 1 || value.backend !== "elftia-electron" ||
			endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" ||
			!endpoint.port || endpoint.pathname !== "/v1/frame" ||
			endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
			typeof value.token !== "string" || !/^[a-f0-9]{64}$/.test(value.token)
		) throw Error();
		token = value.token;
		if (nativeVideo && (value.capabilities?.nativeVideoCapture?.version !== 1 ||
			value.capabilities.nativeVideoCapture.protocol !== ELECTRON_NATIVE_VIDEO_PROTOCOL))
			throw Error();
	} catch {
		throw Error("Elftia Electron capture unavailable; open Elftia with the tool plugin enabled");
	}
	signal.throwIfAborted();
	let response: Response;
	try {
		response = await fetch(endpoint, {
			method: "POST", redirect: "error", signal,
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body: JSON.stringify({ version: 1, width, height, expression, ...(nativeVideo ? { nativeVideo } : {}) }),
		});
	} catch {
		throw Error(signal.aborted ? "Electron capture cancelled" : "Elftia Electron capture connection failed");
	}
	if (!response.ok || response.headers.get("content-type") !== "image/png") {
		await response.body?.cancel();
		if (response.status === 422) throw Error("HTML frame evaluation failed (Elftia Electron)");
		if (response.status === 408) throw Error("HTML frame cancelled or timed out (Elftia Electron)");
		throw Error(`Elftia Electron capture failed (HTTP ${response.status})`);
	}
	// Do not accept an unbounded response even from a misconfigured local service.
	const reader = response.body?.getReader();
	if (!reader) throw Error("Elftia Electron capture returned no PNG");
	const chunks: Buffer[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > 80_000_000) throw Error("Elftia Electron capture PNG too large");
			chunks.push(Buffer.from(value));
		}
	} finally {
		await reader.cancel();
	}
	const png = Buffer.concat(chunks);
	if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
		throw Error("Elftia Electron capture returned invalid PNG");
	return png;
}
