import { spawn as nativeSpawn } from "node:child_process";
import { basename } from "node:path";
export * from "node:child_process";

// Observation only: arguments, returned children and process behavior are unchanged.
const records = [];
Object.defineProperty(globalThis, "__particleC2Processes", { value: records });
export function spawn(...args) {
	const child = nativeSpawn(...args);
	const record = {
		executable: basename(String(args[0])),
		pid: child.pid,
		closed: false,
	};
	records.push(record);
	child.once("close", (code, signal) =>
		Object.assign(record, { closed: true, code, signal }),
	);
	if (typeof child.send === "function") {
		const send = child.send;
		child.send = function (...messages) {
			if (
				messages[0]?.operation === "particleSurface" &&
				typeof globalThis.__particleC2Fault === "function"
			) {
				const fault = globalThis.__particleC2Fault;
				globalThis.__particleC2Fault = undefined;
				record.faultInjected = true;
				fault(child);
			}
			return send.apply(this, messages);
		};
	}
	return child;
}
