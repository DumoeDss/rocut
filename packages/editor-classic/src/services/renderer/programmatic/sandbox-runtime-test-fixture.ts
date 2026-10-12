export class SandboxBitmap {
	width = 64;
	height = 48;
	closed = false;
	close() {
		this.closed = true;
	}
}

class SandboxPort {
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onmessageerror: (() => void) | null = null;
	messages: unknown[] = [];
	closed = false;
	dispatchError = false;
	closeError = false;
	closeCalls = 0;
	postMessage(data: unknown) {
		if (this.dispatchError) throw Error("Port dispatch failed");
		this.messages.push(data);
	}
	close() {
		this.closeCalls++;
		if (this.closeError) throw Error("Port close failed");
		this.closed = true;
	}
}

/** Transport/DOM doubles only; not a raster, admission or pixel oracle. */
export function installSandboxHarness() {
	const channels: { port1: SandboxPort; port2: SandboxPort }[] = [];
	const deadlines: { callback: () => void; milliseconds: number }[] = [];
	let timerCleared = false;
	let removed = false;
	let removeError = false;
	let removeCalls = 0;
	let connections = 0;
	let connectError = false;
	let now = 0;
	const iframe = {
		sandbox: { add() {} },
		hidden: false,
		srcdoc: "",
		onload: () => {},
		setAttribute() {},
		remove() {
			removeCalls++;
			if (removeError) throw Error("Iframe remove failed");
			removed = true;
		},
		contentWindow: {
			postMessage() {
				connections++;
				if (connectError) throw Error("Port transfer failed");
			},
		},
	};
	const replacements = {
		performance: { now: () => now },
		document: {
			createElement() {
				return iframe;
			},
			body: { appendChild() {} },
		},
		ImageBitmap: SandboxBitmap,
		MessageChannel: class {
			port1 = new SandboxPort();
			port2 = new SandboxPort();
			constructor() {
				channels.push(this);
			}
		},
		setTimeout(callback: () => void, milliseconds: number) {
			deadlines.push({ callback, milliseconds });
			return 1;
		},
		clearTimeout() {
			timerCleared = true;
		},
	};
	const originals = new Map<string, PropertyDescriptor | undefined>();
	for (const [name, value] of Object.entries(replacements)) {
		originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, { configurable: true, value });
	}
	return {
		iframe,
		channels,
		deadlines,
		setNow(value: number) {
			now = value;
		},
		get connections() {
			return connections;
		},
		get removeCalls() {
			return removeCalls;
		},
		failRemoval() {
			removeError = true;
		},
		messageError() {
			channels[0].port1.onmessageerror?.();
		},
		get disposed() {
			return (
				removed &&
				timerCleared &&
				channels.every(({ port1, port2 }) => port1.closed && port2.closed)
			);
		},
		failConnection() {
			connectError = true;
		},
		send(data: unknown) {
			channels[0].port1.onmessage?.({ data });
		},
		restore() {
			for (const [name, descriptor] of originals) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else Reflect.deleteProperty(globalThis, name);
			}
		},
	};
}
