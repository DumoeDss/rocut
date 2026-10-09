import { MV_NATIVE_PROTOCOL } from "./mv-native-protocol";
import { TestNativeBitmap } from "./mv-native-test-realm";

/** Deterministic host lifecycle stub. All globals are restored by the caller;
 * no production transport/admission injection hook is exposed for tests. */
export function nativeTestHost() {
	const saved = new Map<string, PropertyDescriptor | undefined>();
	const timers = new Map<number, { callback: () => void; delay: number }>();
	const sent: { type: string; input?: unknown }[] = [];
	let sequence = 0;
	let requestId = "";
	let removed = false;
	class Port {
		closed = false;
		onmessage?: (event: { data: unknown }) => void;
		onmessageerror?: () => void;
		postMessage(data: { type: string; input?: unknown }) {
			sent.push(data);
		}
		close() {
			this.closed = true;
		}
	}
	const port1 = new Port(),
		port2 = new Port();
	const iframe = {
		sandbox: { add(_value: string) {} },
		hidden: false,
		srcdoc: "",
		onload: undefined as undefined | null | (() => void),
		setAttribute(_key: string, _value: string) {},
		remove() {
			removed = true;
		},
		contentWindow: {
			postMessage(data: { requestId: string }) {
				requestId = data.requestId;
			},
		},
	};
	const replace = (name: string, value: unknown) => {
		saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, {
			configurable: true,
			writable: true,
			value,
		});
	};
	replace("document", {
		createElement(kind: string) {
			if (kind !== "iframe") throw Error("Unexpected host element");
			return iframe;
		},
		body: {
			appendChild() {
				iframe.onload?.();
			},
		},
	});
	replace(
		"MessageChannel",
		class {
			port1 = port1;
			port2 = port2;
		},
	);
	replace("ImageBitmap", TestNativeBitmap);
	replace("setTimeout", (callback: () => void, delay: number) => {
		const id = ++sequence;
		timers.set(id, { callback, delay });
		return id;
	});
	replace("clearTimeout", (id: number) => {
		timers.delete(id);
	});
	return {
		port1,
		port2,
		sent,
		get removed() {
			return removed;
		},
		get timerDelays() {
			return [...timers.values()].map((value) => value.delay);
		},
		emit(type: string, extra: Record<string, unknown> = {}) {
			port1.onmessage?.({
				data: { protocol: MV_NATIVE_PROTOCOL, requestId, type, ...extra },
			});
		},
		fire(delay: number) {
			const found = [...timers].find(([, value]) => value.delay === delay);
			if (!found) throw Error(`Missing timer ${delay}`);
			timers.delete(found[0]);
			found[1].callback();
		},
		restore() {
			for (const [name, descriptor] of saved) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else Reflect.deleteProperty(globalThis, name);
			}
		},
	};
}
