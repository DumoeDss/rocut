import { runInNewContext } from "node:vm";
import { MV_NATIVE_DOCUMENT } from "./mv-native-document";
import { MV_NATIVE_CONNECT, MV_NATIVE_PROTOCOL } from "./mv-native-protocol";

export class TestNativeBitmap {
	closed = false;
	constructor(
		readonly width: number,
		readonly height: number,
	) {}
	close() {
		this.closed = true;
	}
}

export function nativeTestInput() {
	return {
		width: 16,
		height: 9,
		frame: {
			recipePlan: {
				version: 1,
				root: { kind: "solid", role: "foreground", color: [1, 0, 0, 1] },
				outputRoles: ["foreground"],
				post: [],
			},
			imageDecodeLimits: { maxDimension: 4096, maxDecodedBytes: 1024 * 1024 },
		},
		resources: [] as unknown[],
		sequenceImages: [],
		imageAdmissions: [] as unknown[],
	};
}

interface TestEnvelope {
	type: string;
	protocol?: string;
	requestId?: string;
	bitmap?: TestNativeBitmap;
	error?: string;
}

/** No browser or WASM process: execute the fixed shipping document against
 * narrow instrumented platform stubs. These tests assert transport/lifetime,
 * never pixels or reference parity.
 */
export function nativeTestRealm(
	options: {
		decode?: (input: unknown) => Promise<TestNativeBitmap>;
		loadFont?: () => Promise<unknown>;
		onYield?: () => void;
	} = {},
) {
	const messages: TestEnvelope[] = [];
	const waiters = new Set<() => void>();
	const surfaces: { width: number; height: number }[] = [];
	const fonts = new Set<unknown>();
	let fontAdds = 0;
	let drawCalls = 0;
	let yields = 0;
	let connect: ((event: unknown) => void) | undefined;
	const parent = {};
	const requestId = "native-test-request";
	const port = {
		onmessage: undefined as undefined | ((event: { data: unknown }) => void),
		onmessageerror: undefined as undefined | (() => void),
		closed: false,
		close() {
			this.closed = true;
		},
		postMessage(value: TestEnvelope) {
			messages.push(value);
			for (const callback of waiters) callback();
		},
	};
	const source = MV_NATIVE_DOCUMENT.match(/<script>([\s\S]*)<\/script>/)?.[1];
	if (!source) throw Error("Missing fixed native script");
	runInNewContext(source, {
		parent,
		ArrayBuffer,
		ImageBitmap: TestNativeBitmap,
		Blob,
		setTimeout(callback: () => void, delay: number) {
			yields++;
			return setTimeout(() => {
				options.onYield?.();
				callback();
			}, delay);
		},
		createImageBitmap:
			options.decode ??
			(async (input: { width: number; height: number }) =>
				new TestNativeBitmap(input.width, input.height)),
		OffscreenCanvas: class {
			constructor() {
				throw Error("Unexpected Offscreen 2D allocation");
			}
		},
		FontFace: class {
			status = "unloaded";
			async load() {
				await options.loadFont?.();
				this.status = "loaded";
				return this;
			}
		},
		document: {
			fonts: {
				add(face: unknown) {
					fontAdds++;
					fonts.add(face);
				},
				delete(face: unknown) {
					fonts.delete(face);
				},
			},
			createElement(kind: string) {
				if (kind !== "canvas") throw Error("Unexpected DOM element");
				const canvas = {
					width: 0,
					height: 0,
					getContext: (_kind: string) => context,
				};
				const context = new Proxy({ canvas } as Record<string, unknown>, {
					get(target, key: string) {
						if (key in target) return target[key];
						return () => {
							if (key === "fillRect" || key === "drawImage") drawCalls++;
						};
					},
				});
				surfaces.push(canvas);
				return canvas;
			},
		},
		addEventListener(_type: string, callback: typeof connect) {
			connect = callback;
		},
		removeEventListener() {
			connect = undefined;
		},
	});
	const handshake = connect;
	if (!handshake) throw Error("Missing native handshake");
	handshake({
		source: parent,
		data: { type: MV_NATIVE_CONNECT, requestId },
		ports: [port],
	});
	const send = (type: string, input?: unknown, id = requestId) =>
		port.onmessage?.({
			data: { protocol: MV_NATIVE_PROTOCOL, requestId: id, type, input },
		});
	return {
		messages,
		surfaces,
		fonts,
		port,
		get fontAdds() {
			return fontAdds;
		},
		get drawCalls() {
			return drawCalls;
		},
		get yields() {
			return yields;
		},
		render(input: unknown) {
			send("render", input);
		},
		dispose(id?: string) {
			send("dispose", undefined, id);
		},
		async result() {
			return new Promise<TestEnvelope>((resolve, reject) => {
				const check = () => {
					const found = messages.find(
						(item) => item.type === "rendered" || item.type === "error",
					);
					if (!found) return;
					clearTimeout(timer);
					waiters.delete(check);
					resolve(found);
				};
				const timer = setTimeout(() => {
					waiters.delete(check);
					reject(Error("Native test response timeout"));
				}, 1000);
				waiters.add(check);
				check();
			});
		},
	};
}
