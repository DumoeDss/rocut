import { createHash } from "node:crypto";
import {
	AUDIO_PHASE_PREFIX,
	AUDIO_PHASES,
} from "./multishot-mv-trace-inner.mjs";

// Never copy a browser expression, asset, arbitrary exception text, or abort payload.
function errorKind(error) {
	try {
		const known = new Set([
			"HTML frame browser cancelled",
			"HTML frame browser closed",
			"HTML frame browser disconnected",
			"HTML frame browser connection failed",
			"The operation was aborted.",
			"The operation was aborted",
		]);
		const message = error instanceof Error ? error.message : "";
		return {
			kind:
				error instanceof Error &&
				["Error", "AbortError", "TimeoutError"].includes(error.name)
					? error.name
					: "unclassified",
			knownMessage: known.has(message) ? message : undefined,
			messageSha256: message
				? createHash("sha256").update(message).digest("hex")
				: undefined,
		};
	} catch {
		return { kind: "uninspectable" };
	}
}

/** Diagnostic-only spy: all work still delegates to the genuine collector/CDP.
 * Even logging failures cannot change the returned value or thrown error object.
 */
export function traceAudioCollector(
	collect,
	record,
	{ instrumentExpression } = {},
) {
	let sequence = 0;
	return async function tracedCollection(browser, options) {
		const id = ++sequence,
			started = performance.now();
		let attachedSessionId;
		const emit = (event, extra = {}) => {
			try {
				record({
					event,
					id,
					at: Date.now(),
					elapsedMs: performance.now() - started,
					frameIndex: Number.isFinite(options.frame?.index)
						? options.frame.index
						: undefined,
					sourceTime: Number.isFinite(options.frame?.time)
						? options.frame.time
						: undefined,
					aborted: options.signal.aborted,
					abortReason: options.signal.aborted
						? errorKind(options.signal.reason)
						: undefined,
					...extra,
				});
			} catch {
				// Instrumentation must not convert genuine success into failure.
			}
		};
		const send = async (...args) => {
			const commandStarted = performance.now();
			const method = args[0];
			emit("cdp-start", { method });
			try {
				if (instrumentExpression && method === "Runtime.evaluate") {
					args = [
						method,
						{
							...args[1],
							expression: instrumentExpression(args[1].expression),
						},
						...args.slice(2),
					];
				}
				const result = await Reflect.apply(browser.send, browser, args);
				if (method === "Target.attachToTarget")
					attachedSessionId = result.sessionId;
				emit("cdp-end", {
					method,
					commandElapsedMs: performance.now() - commandStarted,
				});
				return result;
			} catch (error) {
				emit("cdp-error", {
					method,
					commandElapsedMs: performance.now() - commandStarted,
					error: errorKind(error),
				});
				throw error;
			}
		};
		const unsubscribe =
			instrumentExpression && typeof browser.onEvent === "function"
				? browser.onEvent((event) => {
						if (
							event.method !== "Runtime.consoleAPICalled" ||
							event.sessionId !== attachedSessionId
						)
							return;
						const message = event.params?.args?.[0]?.value;
						if (
							typeof message !== "string" ||
							!message.startsWith(AUDIO_PHASE_PREFIX)
						)
							return;
						try {
							const phase = JSON.parse(
								message.slice(AUDIO_PHASE_PREFIX.length),
							);
							if (AUDIO_PHASES.has(phase.phase) && Number.isFinite(phase.clock))
								emit("bootstrap-phase", {
									phase: phase.phase,
									browserClock: phase.clock,
								});
						} catch {}
					})
				: undefined;
		const observed = new Proxy(browser, {
			get(target, key, receiver) {
				return key === "send" ? send : Reflect.get(target, key, receiver);
			},
		});
		emit("frame-start");
		try {
			const result = await Reflect.apply(collect, this, [observed, options]);
			emit("frame-end");
			return result;
		} catch (error) {
			emit("frame-error", { error: errorKind(error) });
			throw error;
		} finally {
			unsubscribe?.();
		}
	};
}
