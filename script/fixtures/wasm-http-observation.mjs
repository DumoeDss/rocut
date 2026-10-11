import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const MAX_BINARY_BYTES = 15 * 1024 * 1024;
// Classify only explicit transport clues. Never retain raw errors, URLs or headers.
// These are diagnostic categories, not proof of a particular browser root cause.
export function classifyWasmBodyProtocolFailure(error) {
	if (error?.type === "closed") return "protocol-session-closed";
	if (error?.type === "crashed") return "protocol-target-crashed";
	const message =
		typeof error?.message === "string" ? error.message.slice(0, 2048) : "";
	if (
		/session closed|session has been closed|target.*closed|browser.*closed|session already detached/i.test(
			message,
		)
	)
		return "protocol-session-closed";
	if (/target crashed|page crashed/i.test(message))
		return "protocol-target-crashed";
	if (
		/evicted.*(?:inspector|buffer)|(?:inspector|buffer).*evicted/i.test(message)
	)
		return "protocol-body-evicted";
	if (
		/no resource with given identifier|no data found for resource with given identifier/i.test(
			message,
		)
	)
		return "protocol-request-not-found";
	if (
		/method.*not found|wasn't found|unknown method|not implemented|not supported/i.test(
			message,
		)
	)
		return "protocol-command-unavailable";
	if (
		/request is not intercepted|invalid interception|interception.*(?:id|state)|captured after headers received/i.test(
			message,
		)
	)
		return "protocol-interception-state";
	return "protocol-other";
}
/** Node-only original-response evidence. No Response.body() fallback/refetch.
 * Call drain after the original pixel/export checks, before closing context. */
export async function observeProbeWasmHttp(session, expected) {
	assert.match(expected.sha256, /^[a-f0-9]{64}$/);
	assert.ok(
		Number.isSafeInteger(expected.byteLength) &&
			expected.byteLength > 0 &&
			expected.byteLength <= MAX_BINARY_BYTES,
	);
	assert.ok(typeof expected.url === "string" && expected.url.length > 0);
	const entries = new Map();
	let overflow = false,
		invalidEvent = false,
		draining = false,
		lateResponse = false;
	let drained;
	const settle = (entry, record) => {
		if (entry.settled) return;
		entry.settled = true;
		entry.resolve(Object.freeze(record));
	};
	const responseReceived = (event) => {
		if (event.response?.url !== expected.url) return;
		if (draining) {
			lateResponse = true;
			return;
		}
		if (entries.size === 8) {
			overflow = true;
			return;
		}
		if (
			typeof event.requestId !== "string" ||
			!event.requestId ||
			entries.has(event.requestId)
		) {
			invalidEvent = true;
			return;
		}
		let resolve;
		const promise = new Promise((done) => {
			resolve = done;
		});
		const entry = {
			status: event.response.status,
			promise,
			resolve,
			started: false,
			settled: false,
		};
		entries.set(event.requestId, entry);
		if (entry.status !== 200)
			settle(entry, {
				status: entry.status,
				bodyAvailable: false,
				reason: "http-status",
			});
	};
	const loadingFinished = (event) => {
		const entry = entries.get(event.requestId);
		if (!entry || entry.started || entry.settled) return;
		entry.started = true;
		void (async () => {
			let failureStage = "cdp-get-response-body";
			try {
				// Exact original request ID only. Never loadNetworkResource/fetch URL.
				const result = await session.send("Network.getResponseBody", {
					requestId: event.requestId,
				});
				failureStage = "body-shape";
				assert.ok(
					result &&
						typeof result.body === "string" &&
						typeof result.base64Encoded === "boolean",
				);
				failureStage =
					result.body.length === 0 ? "body-empty" : "body-encoded-limit";
				assert.ok(
					result.body.length > 0 &&
						result.body.length <= Math.ceil(MAX_BINARY_BYTES / 3) * 4,
				);
				failureStage = "body-decode";
				const bytes = Buffer.from(
					result.body,
					result.base64Encoded ? "base64" : "utf8",
				);
				failureStage = "body-noncanonical-base64";
				if (result.base64Encoded)
					assert.equal(
						bytes.toString("base64"),
						result.body,
						"Noncanonical base64 body",
					);
				failureStage = "body-decoded-limit";
				assert.ok(bytes.length > 0 && bytes.length <= MAX_BINARY_BYTES);
				settle(entry, {
					status: entry.status,
					byteLength: bytes.length,
					sha256: createHash("sha256").update(bytes).digest("hex"),
					bodyAvailable: true,
				});
			} catch (error) {
				settle(entry, {
					status: entry.status,
					bodyAvailable: false,
					reason: "body-unavailable",
					failureStage,
					failureCategory:
						failureStage === "cdp-get-response-body"
							? classifyWasmBodyProtocolFailure(error)
							: failureStage,
				});
			}
		})();
	};
	const loadingFailed = (event) => {
		const entry = entries.get(event.requestId);
		if (entry)
			settle(entry, {
				status: entry.status,
				bodyAvailable: false,
				reason: "loading-failed",
			});
	};
	const closed = () => {
		for (const entry of entries.values())
			settle(entry, {
				status: entry.status,
				bodyAvailable: false,
				reason: "session-closed",
			});
	};
	const listeners = [
		["Network.responseReceived", responseReceived],
		["Network.loadingFinished", loadingFinished],
		["Network.loadingFailed", loadingFailed],
		["close", closed],
	];
	for (const [event, listener] of listeners) session.on(event, listener);
	const remove = () => {
		for (const [event, listener] of listeners) session.off(event, listener);
	};
	try {
		await session.send("Network.enable", {
			maxTotalBufferSize: MAX_BINARY_BYTES,
			maxResourceBufferSize: MAX_BINARY_BYTES,
		});
	} catch (error) {
		remove();
		throw error;
	}
	return {
		drain() {
			if (drained) return drained;
			draining = true;
			// No wait for an unfinished transfer on a failed original attempt.
			for (const entry of entries.values())
				if (!entry.started && !entry.settled)
					settle(entry, {
						status: entry.status,
						bodyAvailable: false,
						reason: "incomplete-transfer",
					});
			drained = (async () => {
				const records = await Promise.all(
					[...entries.values()].map((entry) => entry.promise),
				);
				remove();
				return Object.freeze({
					profile: "cdp-original-request-body-v3-categories",
					overflow,
					invalidEvent,
					lateResponse,
					ok:
						!overflow &&
						!invalidEvent &&
						!lateResponse &&
						records.length > 0 &&
						records.every(
							(record) =>
								record.bodyAvailable &&
								record.status === 200 &&
								record.byteLength === expected.byteLength &&
								record.sha256 === expected.sha256,
						),
					records: Object.freeze(records),
				});
			})();
			return drained;
		},
	};
}
