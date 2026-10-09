import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import type {
	MvImagePreprocessBinding,
	MvImagePreprocessRequest,
} from "@opencut/editor-contracts";

const wasmDirectory = process.env.ROCUT_RESIDENCY_TEST_WASM_DIR;
if (!wasmDirectory) {
	test.skip("real residency owner requires explicit ROCUT_RESIDENCY_TEST_WASM_DIR", () => {});
} else if (process.env.ROCUT_RESIDENCY_OWNER_ISOLATED !== "1") {
	test("real owner/native joint admission runs in an isolated process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, ROCUT_RESIDENCY_OWNER_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw Error(result.stdout.toString() + result.stderr.toString());
	}, 15000);
} else {
	const module: unknown = await import(
		pathToFileURL(join(wasmDirectory, "opencut_wasm.js")).href
	);
	if (!module || typeof module !== "object")
		throw Error("Invalid explicit WASM module");
	const initialize: unknown = Reflect.get(module, "initSync");
	if (typeof initialize !== "function")
		throw Error("Missing explicit WASM initialization");
	initialize({
		module: readFileSync(join(wasmDirectory, "opencut_wasm_bg.wasm")),
	});
	mock.module("opencut-wasm", () => ({
		MvImagePreprocessOwner: Reflect.get(module, "MvImagePreprocessOwner"),
	}));
	let readbacks = 0;
	let completeReadback: (() => void) | undefined;
	let delayGrace = false;
	let finishGrace: (() => void) | undefined;
	mock.module("./programmatic/image-preprocess-readback", () => ({
		readImagePreprocessRgba: ({
			input,
			signal,
			onDisposed,
		}: {
			input: { request: MvImagePreprocessRequest };
			signal: AbortSignal;
			onDisposed: () => void;
		}) => {
			readbacks++;
			const dispose = () => {
				if (delayGrace) finishGrace = onDisposed;
				else onDisposed();
			};
			return new Promise<Uint8Array>((resolve, reject) => {
				const abort = () => {
					dispose();
					reject(signal.reason);
				};
				signal.addEventListener("abort", abort, { once: true });
				completeReadback = () => {
					signal.removeEventListener("abort", abort);
					resolve(
						new Uint8Array(
							input.request.roi.width * input.request.roi.height * 4,
						).fill(128),
					);
					dispose();
				};
			});
		},
	}));
	const { ImagePreprocessOwner } =
		await import("./programmatic/image-preprocess-owner");
	const { MvImagePreprocessOwner } = await import("opencut-wasm");
	const { RenderResidencyDomain } = await import("./render-residency-domain");
	function metadata() {
		const binding: MvImagePreprocessBinding = {
			resource: {
				id: "x",
				kind: "image",
				attachmentKey: "programmatic-sha256-" + "a".repeat(64),
				mimeType: "image/png",
				byteLength: 4,
				sha256: "a".repeat(64),
			},
			width: 16,
			height: 16,
			flameAt: [4, 4, 8, 4, 12, 4],
			algorithm: "flame-deflame-v1",
		};
		const raw = new MvImagePreprocessOwner();
		try {
			const request: MvImagePreprocessRequest = raw.request(binding);
			return {
				command: {
					kind: "preparedPatch" as const,
					request,
					patchKey: raw.key(binding),
				},
				input: {
					request,
					item: { resource: binding.resource, body: new ArrayBuffer(4) },
					admission: {
						resource: binding.resource,
						width: 16,
						height: 16,
						decodedBytes: 16 * 16 * 4,
					},
					limits: { maxDimension: 4096, maxDecodedBytes: 16 * 16 * 4 },
				},
			};
		} finally {
			raw.free();
		}
	}
	function nativeCapacity(
		owner: InstanceType<typeof ImagePreprocessOwner>,
	): number {
		let low = 0,
			high = 1;
		const admitted = (bytes: number) => {
			try {
				owner.reserve(bytes)();
				return true;
			} catch {
				return false;
			}
		};
		while (admitted(high)) {
			low = high;
			high *= 2;
		}
		while (high - low > 1) {
			const middle = Math.floor((low + high) / 2);
			if (admitted(middle)) low = middle;
			else high = middle;
		}
		return low;
	}
	test("real owner shares preparation across clients while cancelling one independently", async () => {
		readbacks = 0;
		delayGrace = false;
		const owner = new ImagePreprocessOwner(),
			domain = new RenderResidencyDomain({ preprocessor: owner });
		const scope = domain.tree({}),
			a = scope.client({}),
			b = scope.client({}),
			args = metadata();
		const first = a.preprocessor.prepare({ ...args, signal: a.signal });
		const second = b.preprocessor.prepare({ ...args, signal: b.signal });
		a.close();
		await expect(first).rejects.toThrow("cancelled");
		expect(readbacks).toBe(1);
		expect(b.signal.aborted).toBe(false);
		completeReadback!();
		const lease = await second;
		expect(lease.buffer.byteLength).toBeGreaterThan(4);
		lease.release();
		b.close();
		await domain.disposeAndDrain();
		expect(Reflect.get(owner, "native")).toBeUndefined();
	});
	test("real Rust admission counts old realm grace after tree closure and cannot be reset by another root", async () => {
		delayGrace = true;
		const owner = new ImagePreprocessOwner(),
			capacity = nativeCapacity(owner),
			domain = new RenderResidencyDomain({ preprocessor: owner }),
			root = {};
		const client = domain.tree(root).client({});
		const pending = owner.prepare({ ...metadata(), signal: client.signal });
		completeReadback!();
		const lease = await pending;
		lease.release();
		domain.closeTree(root);
		const grace: unknown = Reflect.get(owner, "externalBytes");
		if (typeof grace !== "number") throw Error("Missing real residency ledger");
		expect(grace).toBeGreaterThan(0);
		const fill = owner.reserve(capacity - grace);
		const next = domain.tree({}).client({});
		expect(() => next.reserveCanvas({ width: 1, height: 1 })).toThrow();
		finishGrace!();
		const canvas = next.reserveCanvas({ width: 1, height: 1 });
		canvas.release();
		fill();
		await domain.disposeAndDrain();
		delayGrace = false;
	});
	test("inactive real preparation cache is reclaimed while published canvas remains charged until clear", async () => {
		delayGrace = false;
		const owner = new ImagePreprocessOwner(),
			domain = new RenderResidencyDomain({ preprocessor: owner }),
			scope = domain.tree({}),
			client = scope.client({});
		const pending = owner.prepare({ ...metadata(), signal: client.signal });
		completeReadback!();
		const patch = await pending;
		patch.release();
		const canvas: CanvasImageSource = Reflect.construct(
			class {
				width = 2;
				height = 2;
				close() {}
			},
			[],
		);
		client.reserveCanvas({ width: 2, height: 2 }).attach(canvas);
		domain
			.preparePublication({
				scope,
				textures: [
					{ kind: "external", id: "x", source: canvas, width: 2, height: 2 },
				],
			})
			.commitAfterTextureSync();
		scope.close();
		expect(Reflect.get(owner, "externalBytes")).toBe(32);
		const drain = domain.disposeAndDrain();
		expect(Reflect.get(owner, "native")).not.toBeUndefined();
		domain.releasePublishedAfterClear();
		await drain;
		expect(Reflect.get(owner, "native")).toBeUndefined();
	});
}
