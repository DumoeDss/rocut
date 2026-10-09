import { beforeEach, expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { MvImagePreprocessBinding } from "@opencut/editor-contracts";
import type { ImagePreprocessReadbackInput } from "./image-preprocess-readback";

// WASM/readback doubles must not replace real admission in another test suite.
if (process.env.ROCUT_IMAGE_PREPROCESS_OWNER_ISOLATED !== "1") {
	test("owner lifecycle doubles run in an isolated process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, ROCUT_IMAGE_PREPROCESS_OWNER_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw Error(result.stdout.toString() + result.stderr.toString());
	}, 15000);
} else {
	let readbacks = 0,
		begins = 0,
		frees = 0,
		disposed = 0;
	let completeReadback: (() => void) | undefined;
	let stepsRemaining = 0;
	let stepSizes: number[] = [];
	let delayedDisposal = false,
		completeDisposal: (() => void) | undefined;
	const request = (binding: MvImagePreprocessBinding) => ({
		binding,
		roi: { x: 0, y: 0, width: 1, height: 1 },
	});
	class TestOwner {
		request(binding: MvImagePreprocessBinding) {
			return {
				roi: request(binding).roi,
				binding: {
					...binding,
					resource: Object.fromEntries(
						Object.entries(binding.resource).reverse(),
					),
				},
			};
		}
		key(binding: MvImagePreprocessBinding) {
			return JSON.stringify(binding);
		}
		admit(bytes: number) {
			if (bytes > 256 * 1024 * 1024) throw Error("joint memory budget");
		}
		begin() {
			begins++;
			return 1n;
		}
		step(...[_id, pixels]: [bigint, number]) {
			stepSizes.push(pixels);
			return stepsRemaining-- <= 0;
		}
		take() {
			return new Uint8Array(12);
		}
		dispose() {
			disposed++;
		}
		free() {
			frees++;
		}
	}
	mock.module("opencut-wasm", () => ({ MvImagePreprocessOwner: TestOwner }));
	mock.module("./image-preprocess-readback", () => ({
		readImagePreprocessRgba: ({
			signal,
			onDisposed,
		}: {
			signal: AbortSignal;
			onDisposed?: () => void;
		}) => {
			readbacks++;
			const dispose = () => {
				if (delayedDisposal) completeDisposal = onDisposed;
				else onDisposed?.();
			};
			return new Promise<Uint8Array>((resolve, reject) => {
				const abort = () => {
					dispose();
					reject(signal.reason);
				};
				signal.addEventListener("abort", abort, { once: true });
				completeReadback = () => {
					signal.removeEventListener("abort", abort);
					resolve(new Uint8Array(4));
					dispose();
				};
			});
		},
	}));
	const { ImagePreprocessOwner } = await import("./image-preprocess-owner");
	const { awaitImagePreprocessDeadline } =
		await import("./image-preprocess-deadline");

	function fixture() {
		const binding: MvImagePreprocessBinding = {
			resource: {
				id: "image",
				kind: "image",
				attachmentKey: "test.png",
				mimeType: "image/png",
				byteLength: 4,
				sha256: "a".repeat(64),
			},
			width: 2,
			height: 2,
			flameAt: [1, 1, 1, 1, 1, 1],
			algorithm: "flame-deflame-v1",
		};
		const command = {
			kind: "preparedPatch" as const,
			patchKey: JSON.stringify(binding),
			request: request(binding),
		};
		const input: ImagePreprocessReadbackInput = {
			request: command.request,
			item: { resource: binding.resource, body: new ArrayBuffer(4) },
			admission: {
				resource: binding.resource,
				width: 2,
				height: 2,
				decodedBytes: 16,
			},
			limits: { maxDimension: 4096, maxDecodedBytes: 256 * 1024 * 1024 },
		};
		return { command, input };
	}
	beforeEach(() => {
		stepsRemaining = 0;
		stepSizes = [];
		readbacks = begins = frees = disposed = 0;
		completeReadback = undefined;
		delayedDisposal = false;
		completeDisposal = undefined;
	});

	test("canonical metadata and admitted resources ignore key order but reject extra fields", async () => {
		const owner = new ImagePreprocessOwner();
		const args = fixture();
		Reflect.set(
			args.input.item,
			"resource",
			Object.fromEntries(Object.entries(args.input.item.resource).reverse()),
		);
		const pending = owner.prepare({
			...args,
			signal: new AbortController().signal,
		});
		completeReadback!();
		const lease = await pending;
		expect(readbacks).toBe(1);
		lease.release();
		const bad = fixture();
		Reflect.set(bad.input.item, "resource", { ...bad.input.item.resource });
		Reflect.set(bad.input.item.resource, "unknown", true);
		await expect(
			owner.prepare({ ...bad, signal: new AbortController().signal }),
		).rejects.toThrow("canonical command binding");
		owner.dispose();
	});

	test("cooperative task hops preserve every native step and its fixed size", async () => {
		stepsRemaining = 12;
		const owner = new ImagePreprocessOwner();
		const pending = owner.prepare({
			...fixture(),
			signal: new AbortController().signal,
		});
		completeReadback!();
		const lease = await pending;
		expect(stepSizes).toEqual(Array(13).fill(16384));
		expect(disposed).toBe(1);
		lease.release();
		owner.dispose();
		expect(frees).toBe(1);
	});

	test("one cancelled lease does not cancel another consumer or poison cache", async () => {
		const owner = new ImagePreprocessOwner(),
			a = new AbortController(),
			b = new AbortController();
		const args = fixture();
		const first = owner.prepare({ ...args, signal: a.signal });
		const second = owner.prepare({ ...args, signal: b.signal });
		a.abort(Error("cancel first"));
		await expect(first).rejects.toThrow("cancel first");
		completeReadback!();
		const result = await second;
		expect(readbacks).toBe(1);
		expect(begins).toBe(1);
		expect(disposed).toBe(1);
		const cached = await owner.prepare({
			...args,
			signal: new AbortController().signal,
		});
		expect(cached.buffer).toBe(result.buffer);
		expect(readbacks).toBe(1);
		result.release();
		cached.release();
		owner.dispose();
		await Promise.resolve();
		expect(frees).toBe(1);
	});
	test("all consumers cancel owned readback and next request can retry", async () => {
		const owner = new ImagePreprocessOwner(),
			abort = new AbortController(),
			args = fixture();
		const pending = owner.prepare({ ...args, signal: abort.signal });
		abort.abort(Error("cancel all"));
		await expect(pending).rejects.toThrow("cancel all");
		const retry = owner.prepare({
			...args,
			signal: new AbortController().signal,
		});
		completeReadback!();
		(await retry).release();
		expect(readbacks).toBe(2);
		expect(begins).toBe(1);
		owner.dispose();
	});
	test("owner free waits for owned preparation to unwind", async () => {
		const owner = new ImagePreprocessOwner();
		const pending = owner.prepare({
			...fixture(),
			signal: new AbortController().signal,
		});
		owner.dispose();
		expect(frees).toBe(0);
		await expect(pending).rejects.toThrow("disposed");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(frees).toBe(1);
	});
	test("canonical key or ROI substitution fails before readback", async () => {
		const owner = new ImagePreprocessOwner(),
			args = fixture();
		args.command.patchKey = "invented";
		await expect(
			owner.prepare({ ...args, signal: new AbortController().signal }),
		).rejects.toThrow("canonical");
		expect(readbacks).toBe(0);
		owner.dispose();
	});
	test("joint reservation fails closed and releases exactly once", () => {
		const owner = new ImagePreprocessOwner(),
			release = owner.reserve(256 * 1024 * 1024);
		expect(() => owner.reserve(1)).toThrow("budget");
		release();
		release();
		const second = owner.reserve(256 * 1024 * 1024);
		second();
		owner.dispose();
	});
	test("readback input cannot substitute another binding under a canonical key", async () => {
		const owner = new ImagePreprocessOwner(),
			args = fixture();
		args.input.request = {
			...args.command.request,
			roi: { x: 1, y: 0, width: 1, height: 1 },
		};
		await expect(
			owner.prepare({ ...args, signal: new AbortController().signal }),
		).rejects.toThrow("command binding");
		const other = fixture();
		other.input.item = {
			...other.input.item,
			resource: { ...other.input.item.resource, attachmentKey: "other.png" },
		};
		await expect(
			owner.prepare({ ...other, signal: new AbortController().signal }),
		).rejects.toThrow("command binding");
		expect(readbacks).toBe(0);
		owner.dispose();
	});
	test("returned lease pins bytes through the prepare-to-render reservation window", async () => {
		const owner = new ImagePreprocessOwner(),
			pending = owner.prepare({
				...fixture(),
				signal: new AbortController().signal,
			});
		completeReadback!();
		const lease = await pending;
		const release = owner.reserve(256 * 1024 * 1024 - lease.residentBytes);
		expect(() => owner.reserve(1)).toThrow("budget");
		lease.release();
		const evicted = owner.reserve(1);
		evicted();
		release();
		owner.dispose();
		expect(frees).toBe(1);
	});
	test("dispose drains readback grace reservations before free without resetting bytes", async () => {
		delayedDisposal = true;
		const owner = new ImagePreprocessOwner(),
			pending = owner.prepare({
				...fixture(),
				signal: new AbortController().signal,
			});
		completeReadback!();
		const lease = await pending;
		lease.release();
		owner.dispose();
		expect(frees).toBe(0);
		completeDisposal!();
		expect(frees).toBe(1);
		completeDisposal!();
		expect(frees).toBe(1);
	});
	test("deadline abort rejects an uncooperative platform promise", async () => {
		const abort = new AbortController();
		const pending = awaitImagePreprocessDeadline({
			promise: new Promise(() => {}),
			signal: abort.signal,
		});
		abort.abort(Error("bounded deadline"));
		await expect(pending).rejects.toThrow("bounded deadline");
	});
	test("dispose-and-drain waits for pinned output and readback grace and is idempotent", async () => {
		delayedDisposal = true;
		const owner = new ImagePreprocessOwner();
		const pending = owner.prepare({
			...fixture(),
			signal: new AbortController().signal,
		});
		completeReadback!();
		const lease = await pending;
		const drain = owner.disposeAndDrain();
		expect(owner.disposeAndDrain()).toBe(drain);
		let done = false;
		void drain.then(() => {
			done = true;
		});
		await Promise.resolve();
		expect(done).toBe(false);
		lease.release();
		await Promise.resolve();
		expect(done).toBe(false);
		expect(frees).toBe(0);
		completeDisposal!();
		await drain;
		expect(frees).toBe(1);
		expect(done).toBe(true);
	});
	test("dispose-and-drain observes cancelled pending sessions and handles an empty owner", async () => {
		delayedDisposal = true;
		const owner = new ImagePreprocessOwner();
		const pending = owner.prepare({
			...fixture(),
			signal: new AbortController().signal,
		});
		const drain = owner.disposeAndDrain();
		await expect(pending).rejects.toThrow("disposed");
		let done = false;
		void drain.then(() => {
			done = true;
		});
		await Promise.resolve();
		expect(done).toBe(false);
		expect(frees).toBe(0);
		completeDisposal!();
		await drain;
		expect(frees).toBe(1);
		const empty = new ImagePreprocessOwner();
		await empty.disposeAndDrain();
		expect(frees).toBe(1);
	});
}
