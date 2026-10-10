import { spawn } from "node:child_process";
import {
	boundedText,
	parseLiquidTransportPolicy,
	record,
	type LiquidTransportPolicy,
} from "./engines/three-liquid-object-transport-codec";

/** Internal seam: production supplies only one captured fixed entry and module. */
export function spawnLiquidObjectProcess({
	moduleUrl,
	workerEntrySource,
}: {
	moduleUrl: string;
	workerEntrySource: string;
}) {
	if (
		!moduleUrl.startsWith("data:text/javascript;base64,") ||
		Buffer.byteLength(workerEntrySource, "utf8") > 8_192
	)
		throw Error("Invalid captured Liquid process entry");
	boundedText({ text: moduleUrl, maximum: 256 * 1024 * 1024 });
	const child = spawn(
		process.execPath,
		["--input-type=module", "--eval", workerEntrySource],
		{
			windowsHide: true,
			stdio: ["ignore", "ignore", "ignore", "ipc"],
			serialization: "json",
			env: Object.fromEntries(
				Object.entries(process.env).filter(
					([key]) =>
						!["NODE_OPTIONS", "BUN_OPTIONS"].includes(key.toUpperCase()),
				),
			),
		},
	);
	let closed = false,
		terminal: Error | undefined,
		termination: Promise<void> | undefined;
	let policy: LiquidTransportPolicy | undefined,
		pending:
			| {
					resolve(value: string): void;
					reject(reason: Error): void;
					maximum: number;
			  }
			| undefined;
	let resolveClose!: () => void;
	const confirmedClose = new Promise<void>((resolve) => {
		resolveClose = resolve;
	});
	const fail = (reason: unknown) => {
		terminal ??=
			reason instanceof Error ? reason : Error("Liquid process failed");
		pending?.reject(terminal);
		pending = undefined;
		return terminal;
	};
	const stop = (reason: unknown) => {
		fail(reason);
		void terminate().catch(() => {});
	};
	child.on("error", stop);
	child.on("close", () => {
		closed = true;
		fail(Error("Liquid process closed"));
		resolveClose();
	});
	child.on("message", (value: unknown) => {
		try {
			if (terminal || !pending) throw Error("Unexpected Liquid process reply");
			const json = boundedText({ text: value, maximum: pending.maximum });
			const parsed: unknown = JSON.parse(json);
			if (
				parsed &&
				typeof parsed === "object" &&
				"kind" in parsed &&
				parsed.kind === "failure"
			)
				throw Error("Liquid process rejected initialization or execution");
			const current = pending;
			pending = undefined;
			current.resolve(json);
		} catch (reason) {
			stop(reason);
		}
	});
	function terminate(): Promise<void> {
		return (termination ??= (async () => {
			fail(Error("Liquid process terminated"));
			if (closed) return;
			if (
				child.exitCode === null &&
				child.signalCode === null &&
				!child.kill("SIGKILL")
			)
				throw Error(
					"Liquid process kill was not accepted; ownership remains unfinished",
				);
			await confirmedClose;
		})());
	}
	function exchange({
		value,
		maximum,
	}: {
		value:
			| string
			| {
					version: number;
					kind: string;
					moduleUrl?: string;
					frameJson?: string;
					policyJson?: string;
			  };
		maximum: number;
	}): Promise<string> {
		if (terminal) return Promise.reject(terminal);
		if (pending || !child.connected) {
			const reason = fail(
				Error("Liquid process IPC unavailable or concurrent request"),
			);
			void terminate().catch(() => {});
			return Promise.reject(reason);
		}
		if (typeof value === "string") boundedText({ text: value, maximum });
		return new Promise((resolve, reject) => {
			pending = { resolve, reject, maximum };
			child.send(value, (error) => {
				if (error) stop(error);
			});
		});
	}
	return {
		child,
		confirmedClose,
		terminate,
		fail,
		async discover() {
			const json = await exchange({
				value: { version: 1, kind: "discover", moduleUrl },
				maximum: 65_536,
			});
			const reply = record({
				value: JSON.parse(json),
				keys: ["version", "kind", "policyJson"],
			});
			if (
				reply.version !== 1 ||
				reply.kind !== "policy" ||
				typeof reply.policyJson !== "string"
			)
				throw fail(Error("Invalid Liquid policy handshake"));
			policy = parseLiquidTransportPolicy(reply.policyJson);
			return { policy, policyJson: reply.policyJson };
		},
		async activate({
			frameJson,
			policyJson,
		}: {
			frameJson: string;
			policyJson: string;
		}) {
			if (!policy) throw fail(Error("Liquid policy not discovered"));
			boundedText({ text: frameJson, maximum: policy.maxControlJsonBytes });
			const reply = JSON.parse(
				await exchange({
					value: { version: 1, kind: "activate", frameJson, policyJson },
					maximum: policy.maxControlJsonBytes,
				}),
			);
			if (
				reply.version !== 1 ||
				reply.kind !== "ready" ||
				Object.keys(reply).length !== 2
			)
				throw fail(Error("Invalid Liquid owner readiness"));
		},
		command(json: string) {
			if (!policy)
				return Promise.reject(fail(Error("Liquid policy not discovered")));
			return exchange({
				value: boundedText({ text: json, maximum: policy.maxControlJsonBytes }),
				maximum: policy.maxControlJsonBytes,
			});
		},
		evaluate(envelope: string) {
			if (!policy)
				return Promise.reject(fail(Error("Liquid policy not discovered")));
			return exchange({
				value: boundedText({
					text: envelope,
					maximum: policy.maxRequestEnvelopeBytes,
				}),
				maximum: policy.maxResponseEnvelopeBytes,
			});
		},
	};
}
