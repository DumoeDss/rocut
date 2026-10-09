import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import {
	THREE_ASSETS_DRIVER,
	THREE_PARTICLE_ASSETS_DRIVER,
} from "../programmatic/engines/three-assets-driver";

type Lease = {
	dispose(): void | Promise<void>;
	value?: { image: { width: number; height: number } };
	createInstance?(): Lease;
};
type Loader = (asset: { id: string }) => Promise<Lease>;
type Assets = {
	api: {
		model(id: string): Promise<Lease>;
		texture(id: string, role?: string): Promise<Lease>;
		environment(id: string): Promise<Lease>;
	};
	dispose(): Promise<void>;
};

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function assetsWith(loaders: {
	model?: Loader;
	texture?: Loader;
	environment?: Loader;
}): Assets {
	const missing = async () => {
		throw Error("Unexpected loader invocation");
	};
	const source = THREE_PARTICLE_ASSETS_DRIVER.replace(/^import .+;$/gm, "");
	const createAssets = runInNewContext(`${source}\ncreateAssets`, {
		DOMException,
		AggregateError,
		loadModel: loaders.model ?? missing,
		loadTexture: loaders.texture ?? missing,
		loadEnvironment: loaders.environment ?? missing,
		sha256: () => new Uint8Array(32),
		window: {
			rocutResources: {
				descriptor(id: string) {
					return {
						id,
						kind: id.split(":")[0],
						mimeType: "application/octet-stream",
						byteLength: 1,
						sha256: "0".repeat(64),
					};
				},
				bytes: () => new Uint8Array([0]).buffer,
			},
		},
	}) as (frame: object, signal: AbortSignal) => Assets;
	return createAssets({ resourceLimits: {} }, new AbortController().signal);
}

async function flushMicrotasks() {
	for (let turn = 0; turn < 12; turn++) await Promise.resolve();
}

async function cleanupError(cleanup: Promise<void>): Promise<AggregateError> {
	const error = await cleanup.then(
		() => undefined,
		(value: unknown) => value,
	);
	expect(error).toBeInstanceOf(AggregateError);
	return error as AggregateError;
}

describe("particle Three asset lifecycle", () => {
	test("keeps the actual legacy driver bytes unchanged", () => {
		expect(Buffer.byteLength(THREE_ASSETS_DRIVER)).toBe(2521);
		expect(createHash("sha256").update(THREE_ASSETS_DRIVER).digest("hex")).toBe(
			"e72eb6a1df7515ca50e56627768d8bead3a376aed034a08a76751a422053c300",
		);
		expect(THREE_PARTICLE_ASSETS_DRIVER).not.toBe(THREE_ASSETS_DRIVER);
	});

	test("releases every lease and aggregates synchronous and asynchronous errors", async () => {
		const released: string[] = [];
		const syncError = Error("third lease failed synchronously");
		const asyncError = Error("second lease failed asynchronously");
		const assets = assetsWith({
			texture: async ({ id }) => ({
				dispose() {
					released.push(id);
					if (id === "image:third") throw syncError;
					if (id === "image:second") return Promise.reject(asyncError);
				},
			}),
		});
		for (const id of ["first", "second", "third"])
			await assets.api.texture(`image:${id}`);
		const error = await cleanupError(assets.dispose());
		expect(released).toEqual(["image:third", "image:second", "image:first"]);
		expect(error.errors).toEqual([syncError, asyncError]);
		expect(error.cause).toBe(syncError);
	});

	test("awaits an asynchronous disposer and rejects its late failure", async () => {
		const release = deferred<void>();
		const failure = Error("late release failure");
		const assets = assetsWith({
			texture: async () => ({ dispose: () => release.promise }),
		});
		await assets.api.texture("image:pending");
		let settled = false;
		const cleanup = assets.dispose();
		void cleanup.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			},
		);
		await flushMicrotasks();
		expect(settled).toBe(false);
		release.reject(failure);
		const error = await cleanupError(cleanup);
		expect(error.errors).toEqual([failure]);
		expect(error.cause).toBe(failure);
	});

	test("returns one cleanup promise and never releases an owned lease twice", async () => {
		let releases = 0;
		const release = deferred<void>();
		const assets = assetsWith({
			texture: async () => ({
				dispose() {
					releases++;
					return release.promise;
				},
			}),
		});
		await assets.api.texture("image:once");
		const cleanup = assets.dispose();
		expect(assets.dispose()).toBe(cleanup);
		expect(releases).toBe(1);
		release.resolve();
		await cleanup;
		expect(assets.dispose()).toBe(cleanup);
		expect(releases).toBe(1);
		await expect(
			assets.api.texture("image:after-dispose"),
		).rejects.toMatchObject({
			name: "AbortError",
		});
	});

	test("waits for an unawaited load and the late lease's asynchronous release", async () => {
		const loaded = deferred<Lease>();
		const release = deferred<void>();
		let releases = 0;
		const assets = assetsWith({ texture: () => loaded.promise });
		const operation = assets.api.texture("image:late");
		let settled = false;
		const cleanup = assets.dispose().then(() => {
			settled = true;
		});
		await flushMicrotasks();
		expect(settled).toBe(false);
		loaded.resolve({
			dispose() {
				releases++;
				return release.promise;
			},
		});
		await flushMicrotasks();
		expect(releases).toBe(1);
		expect(settled).toBe(false);
		release.resolve();
		await expect(operation).rejects.toMatchObject({ name: "AbortError" });
		await cleanup;
		expect(settled).toBe(true);
	});

	test("retains late lease failure exactly once across load and operation rejection", async () => {
		const loaded = deferred<Lease>();
		const release = deferred<void>();
		const failure = Error("late lease cannot release");
		const assets = assetsWith({ texture: () => loaded.promise });
		const operation = assets.api.texture("image:late-failure");
		const cleanup = assets.dispose();
		loaded.resolve({ dispose: () => release.promise });
		await flushMicrotasks();
		release.reject(failure);
		await expect(operation).rejects.toBe(failure);
		const error = await cleanupError(cleanup);
		expect(error.errors).toEqual([failure]);
		expect(error.cause).toBe(failure);
	});

	test("waits for a model instance created after its cached load already settled", async () => {
		const lateRelease = deferred<void>();
		const released: string[] = [];
		let instances = 0;
		const assets = assetsWith({
			model: async () => ({
				dispose() {
					released.push("model");
				},
				createInstance() {
					const number = ++instances;
					return {
						dispose() {
							released.push(`instance:${number}`);
							if (number === 2) return lateRelease.promise;
						},
					};
				},
			}),
		});
		await assets.api.model("model:shared");
		const operation = assets.api.model("model:shared");
		let settled = false;
		const cleanup = assets.dispose().then(() => {
			settled = true;
		});
		await flushMicrotasks();
		expect(instances).toBe(2);
		expect(released).toEqual(["instance:1", "model", "instance:2"]);
		expect(settled).toBe(false);
		lateRelease.resolve();
		await expect(operation).rejects.toMatchObject({ name: "AbortError" });
		await cleanup;
		expect(settled).toBe(true);
	});

	test("a late model-instance disposer failure rejects cleanup", async () => {
		const lateRelease = deferred<void>();
		const failure = Error("late model instance release failed");
		let instances = 0;
		const assets = assetsWith({
			model: async () => ({
				dispose() {},
				createInstance() {
					const number = ++instances;
					return {
						dispose: () => (number === 2 ? lateRelease.promise : undefined),
					};
				},
			}),
		});
		await assets.api.model("model:shared");
		const operation = assets.api.model("model:shared");
		const cleanup = assets.dispose();
		await flushMicrotasks();
		lateRelease.reject(failure);
		await expect(operation).rejects.toBe(failure);
		expect((await cleanupError(cleanup)).errors).toEqual([failure]);
	});

	test("awaits and retains failed cleanup of an undersized environment", async () => {
		const release = deferred<void>();
		const failure = Error("invalid environment release failed");
		let releases = 0;
		const assets = assetsWith({
			environment: async () => ({
				value: { image: { width: 32, height: 16 } },
				dispose() {
					releases++;
					return release.promise;
				},
			}),
		});
		const operation = assets.api.environment("environment:small");
		await flushMicrotasks();
		expect(releases).toBe(1);
		let settled = false;
		const cleanup = assets.dispose();
		void cleanup.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			},
		);
		await flushMicrotasks();
		expect(settled).toBe(false);
		release.reject(failure);
		await expect(operation).rejects.toBe(failure);
		expect((await cleanupError(cleanup)).errors).toEqual([failure]);
		expect(releases).toBe(1);
	});

	test("pending loader rejection cannot turn into successful cleanup", async () => {
		const loaded = deferred<Lease>();
		const failure = Error("late loader failure");
		const assets = assetsWith({ texture: () => loaded.promise });
		const operation = assets.api.texture("image:broken");
		const cleanup = assets.dispose();
		loaded.reject(failure);
		await expect(operation).rejects.toBe(failure);
		expect((await cleanupError(cleanup)).errors).toEqual([failure]);
	});
});
