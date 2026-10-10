import { terminateLiquidTransport } from "./three-liquid-object-transport-termination";
import {
	boundedText,
	decodeLiquidTransportResponse,
	parseLiquidTransportFrame,
	parseLiquidTransportPolicy,
	prepareLiquidTransportRequest,
	type LiquidTransportIdentity,
} from "./three-liquid-object-transport-codec";

export interface LiquidObjectAdmissionChannel {
	/** The fixed worker owns one opaque Rust session; never accepts serialized state. */
	command(json: string): Promise<string>;
	terminate(): Promise<void>;
}
export function createThreeLiquidObjectTransport({
	frameJson,
	policyJson,
	admission,
	evaluate,
	signal,
}: {
	/** Trusted Host mapped identity, not a field submitted by authored source. */
	frameJson: string;
	/** Rust publication pinned to the same worker identity as admission/evaluate. */
	policyJson: string;
	admission: LiquidObjectAdmissionChannel;
	/** Fixed worker wire codec: returns a full encoded envelope, not a bare geometry object. */
	evaluate(envelope: string, signal: AbortSignal): Promise<string>;
	signal: AbortSignal;
}) {
	const policy = parseLiquidTransportPolicy(policyJson);
	const frame = parseLiquidTransportFrame({ frameJson, policy });
	const controller = new AbortController();
	let terminal: Error | undefined,
		phase = "created",
		requestId = 0,
		pending = false;
	let rejectFailure!: (error: Error) => void;
	const failure = new Promise<never>((_, reject) => {
		rejectFailure = reject;
	});
	failure.catch(() => {});
	const rawCommand = async (command: object) => {
		const json = boundedText({
			text: JSON.stringify(command),
			maximum: policy.maxControlJsonBytes,
		});
		const response = boundedText({
			text: await Promise.race([admission.command(json), failure]),
			maximum: policy.maxControlJsonBytes,
		});
		const parsed = JSON.parse(response);
		if (parsed.version !== 1 || parsed.ok !== true)
			throw Error(
				`Rust Liquid admission rejected: ${parsed.error?.code ?? "envelope"}`,
			);
		return parsed;
	};
	const fail = (cause: unknown): Error => {
		if (!terminal) {
			terminal = cause instanceof Error ? cause : Error(String(cause));
			phase = "failed";
			controller.abort(terminal);
			rejectFailure(terminal);
			// Notification has no admission refund. Termination/cleanup owns completion.
			void rawCommand({ operation: "fail", frame }).catch(() => {});
		}
		return terminal;
	};
	const check = () => {
		if (terminal) throw terminal;
		controller.signal.throwIfAborted();
	};
	const abort = () => fail(signal.reason ?? Error("Liquid Host cancelled"));
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) abort();
	const timer = setTimeout(
		() => fail(Error("Liquid whole-frame timeout")),
		policy.frameTimeoutMs,
	);
	let disposePromise: Promise<void> | undefined;
	return Object.freeze({
		frame,
		policy,
		failure,
		fail,
		async open() {
			try {
				check();
				if (phase !== "created") throw Error("Liquid transport can open once");
				await rawCommand({ operation: "open", frame });
				check();
				phase = "open";
			} catch (error) {
				throw fail(error);
			}
		},
		async evaluate(requestJson: unknown): Promise<string> {
			let timeout: ReturnType<typeof setTimeout> | undefined;
			try {
				check();
				if (phase !== "open" || pending)
					throw Error(
						"Liquid request is outside phase or another request is pending",
					);
				pending = true;
				timeout = setTimeout(
					() => fail(Error("Liquid request timeout")),
					policy.requestTimeoutMs,
				);
				const identity: LiquidTransportIdentity = {
					frame,
					requestId: ++requestId,
				};
				const prepared = prepareLiquidTransportRequest({
					requestJson,
					identity,
					policy,
				});
				const accepted = await rawCommand({
					operation: "reserve",
					identity,
					meshId: identity.requestId,
					vertices: prepared.vertices,
					requestJsonBytes: prepared.requestJsonBytes,
					requestEnvelopeBytes: prepared.requestEnvelopeBytes,
				});
				check();
				const reservation = accepted.reservation;
				if (
					!reservation ||
					reservation.requestId !== identity.requestId ||
					!Number.isSafeInteger(reservation.maxResponseJsonBytes) ||
					!Number.isSafeInteger(reservation.maxResponseEnvelopeBytes)
				)
					throw Error("Invalid Rust Liquid reservation publication");
				// Encode only after Rust's whole-frame reservation, using exact UTF-8 counts.
				const envelope = prepared.encode();
				const response = await Promise.race([
					Promise.resolve(evaluate(envelope, controller.signal)),
					failure,
				]);
				check();
				const decoded = decodeLiquidTransportResponse({
					response,
					expected: identity,
					policy,
					reserved: reservation,
					vertices: prepared.vertices,
				});
				await rawCommand({
					operation: "settle",
					identity,
					responseJsonBytes: decoded.responseJsonBytes,
					responseEnvelopeBytes: decoded.responseEnvelopeBytes,
				});
				check();
				return decoded.payloadJson;
			} catch (error) {
				throw fail(error);
			} finally {
				if (timeout) clearTimeout(timeout);
				pending = false;
			}
		},
		async close() {
			try {
				check();
				if (phase !== "open" || pending)
					throw Error("Liquid close requires a settled open phase");
				await rawCommand({ operation: "close", frame });
				check();
				phase = "closed";
			} catch (error) {
				throw fail(error);
			}
		},
		check() {
			check();
			if (phase !== "closed" || pending)
				throw fail(Error("Liquid frame is not closed and settled"));
		},
		dispose() {
			if (disposePromise) return disposePromise;
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			const prior = terminal;
			phase = "disposed";
			controller.abort(Error("Liquid transport disposed"));
			rejectFailure(prior ?? Error("Liquid transport disposed"));
			disposePromise = terminateLiquidTransport({
				admission,
				prior,
				timeoutMs: policy.terminationTimeoutMs,
			});
			return disposePromise;
		},
	});
}
