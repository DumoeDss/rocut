import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// Keep byte payloads out of errors. Failed gate evidence is not acceptance.
export function nativeAudioResultSummary(result) {
	if (!result || typeof result !== "object") return { available: false };
	const summary = { available: true };
	for (const key of [
		"frames",
		"worst",
		"nativeAudioRequests",
		"editorMixerTested",
		"installedEditorTested",
	])
		if (["number", "boolean"].includes(typeof result[key]))
			summary[key] = result[key];
	for (const key of ["error", "stack"])
		if (typeof result[key] === "string")
			summary[key] = result[key].slice(0, 2000);
	for (const key of ["bytes", "pcm"])
		if (Array.isArray(result[key]))
			summary[key + "Length"] = result[key].length;
	return summary;
}

export function nativeAudioHttpObservation(response) {
	const url = new URL(response.url());
	return {
		status: response.status(),
		// No credentials, query values, fragments or headers in diagnostics.
		url: url.origin + url.pathname,
		resourceType: response.request().resourceType(),
	};
}

export async function saveNativeAudioProbeFailure({
	directory,
	result,
	errors,
	httpFailures,
	networkObservations,
	failure,
	wasmIdentity,
	hostWasmIdentity,
	sourceInputs,
}) {
	const artifacts = [];
	if (directory && result && typeof result === "object") {
		for (const [key, name] of [
			["bytes", "failed-export.webm"],
			["pcm", "failed-reference.f32le"],
		]) {
			const value = result[key];
			if (
				!Array.isArray(value) ||
				!value.every(
					(byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
				)
			)
				continue;
			const bytes = Buffer.from(value);
			await writeFile(join(directory, name), bytes, { flag: "wx" });
			artifacts.push({
				name,
				byteLength: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			});
		}
	}
	const diagnostic = {
		schema: "rocut-native-audio-probe-failure/v1",
		passed: false,
		acceptanceEvidence: false,
		failure: String(failure).slice(0, 4000),
		result: nativeAudioResultSummary(result),
		errors: errors ?? [],
		httpFailures: httpFailures ?? [],
		networkObservations: networkObservations ?? null,
		wasmIdentity: wasmIdentity ?? null,
		hostWasmIdentity: hostWasmIdentity ?? null,
		sourceInputs: sourceInputs ?? null,
		artifacts,
		limitations:
			"Failure-only observation; no decode, console gate exemption, retry or installed/Electron acceptance is implied.",
	};
	if (directory)
		await writeFile(
			join(directory, "failure.json"),
			JSON.stringify(diagnostic, null, 2) + "\n",
			{ flag: "wx", encoding: "utf8" },
		);
	return diagnostic;
}
