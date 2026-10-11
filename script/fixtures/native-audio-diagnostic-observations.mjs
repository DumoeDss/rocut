import { createHash } from "node:crypto";

// Passive network observations only; do not alter the original console gate.
export function nativeAudioDiagnosticUrl({ value, pathOnly = false }) {
	if (typeof value !== "string" || value.length > 16384 || !value) return null;
	try {
		const url = new URL(
			value,
			pathOnly ? "http://diagnostic.invalid" : undefined,
		);
		if (!["http:", "https:"].includes(url.protocol)) return "[non-http-url]";
		return pathOnly ? url.pathname : url.origin + url.pathname;
	} catch {
		return null;
	}
}
export function nativeAudioConsoleObservation({ message, page }) {
	let location = {},
		pageUrl = null,
		text = "";
	try {
		location = message.location() ?? {};
	} catch {
		/* The observed browser field can be unavailable. */
	}
	try {
		pageUrl = nativeAudioDiagnosticUrl({ value: page.url() });
	} catch {
		/* The observed browser field can be unavailable. */
	}
	try {
		text = message.text();
	} catch {
		/* The observed browser field can be unavailable. */
	}
	return {
		observedAt: new Date().toISOString(),
		pageUrl,
		location: {
			url: nativeAudioDiagnosticUrl({ value: location.url }),
			lineNumber: Number.isSafeInteger(location.lineNumber)
				? location.lineNumber
				: null,
			columnNumber: Number.isSafeInteger(location.columnNumber)
				? location.columnNumber
				: null,
		},
		textLength: text.length,
		textSha256: createHash("sha256").update(text).digest("hex"),
		reports404: /status of 404/.test(text),
	};
}
export function nativeAudioContextHttpObservation(response) {
	const request = response.request();
	let frameUrl = null,
		pageUrl = null,
		serviceWorkerUrl = null;
	try {
		const frame = request.frame();
		frameUrl = nativeAudioDiagnosticUrl({ value: frame.url() });
		pageUrl = nativeAudioDiagnosticUrl({ value: frame.page().url() });
	} catch {
		/* The observed browser field can be unavailable. */
	}
	try {
		serviceWorkerUrl = nativeAudioDiagnosticUrl({
			value: request.serviceWorker?.()?.url(),
		});
	} catch {
		/* The observed browser field can be unavailable. */
	}
	return {
		observedAt: new Date().toISOString(),
		status: response.status(),
		url: nativeAudioDiagnosticUrl({ value: response.url() }),
		resourceType: request.resourceType(),
		method: request.method(),
		frameUrl,
		pageUrl,
		serviceWorkerUrl,
	};
}
export function nativeAudioServerObservation({ server, url, method, status }) {
	return {
		observedAt: new Date().toISOString(),
		server: ["vite", "fixture"].includes(server) ? server : "unknown",
		path: nativeAudioDiagnosticUrl({ value: url, pathOnly: true }),
		method:
			typeof method === "string" && /^[A-Z]{1,16}$/.test(method)
				? method
				: null,
		status: Number.isSafeInteger(status) ? status : null,
	};
}
