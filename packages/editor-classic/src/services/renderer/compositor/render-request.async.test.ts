import { expect, test } from "bun:test";
import {
	renderFrameRequest,
	renderFramePngRequest,
	type NativeFramePng,
	type RenderFrameRequestApi,
} from "./render-request";

type Args = Parameters<typeof renderFrameRequest>[0];
const frame: Args["frame"] = {
	width: 8,
	height: 8,
	clear: { color: [0, 0, 0, 0] },
	items: [],
};
const pngResult: NativeFramePng = {
	png: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
	width: 8,
	height: 8,
	handle: 1,
	requestId: 7,
	owner: "1",
	generation: "1",
	peakBytes: 4096,
	format: "rgba8unorm",
	alphaMode: "straight",
	colorSpace: "srgb",
	mimeType: "image/png",
	backend: "webgl",
};
test("native PNG abort cancels immediately but drains the actual commit", async () => {
	const mock = api(() => true),
		abort = new AbortController();
	let resolve!: (value: NativeFramePng) => void;
	const native = new Promise<NativeFramePng>((yes) => {
		resolve = yes;
	});
	Object.assign(mock.value, { commitRenderFramePngForHandle: () => native });
	let settled = false;
	const task = renderFramePngRequest({
		api: mock.value,
		resources,
		frame,
		handle: 1,
		signal: abort.signal,
	});
	const outcome = task.then(
		() => {
			settled = true;
			return "published";
		},
		(error) => {
			settled = true;
			return error.name;
		},
	);
	abort.abort();
	await Promise.resolve();
	expect(mock.calls).toEqual(["begin", "cancel"]);
	expect(settled).toBe(false);
	resolve(pngResult);
	expect(await outcome).toBe("AbortError");
});
test("native PNG consumes the same prepared request and validates exact identity", async () => {
	const mock = api(() => true);
	Object.assign(mock.value, {
		commitRenderFramePngForHandle: async () => pngResult,
	});
	expect(
		await renderFramePngRequest({
			api: mock.value,
			resources,
			frame,
			handle: 1,
		}),
	).toBe(pngResult);
	expect(mock.calls).toEqual(["begin"]);
	Object.assign(mock.value, {
		commitRenderFramePngForHandle: async () => ({ ...pngResult, requestId: 8 }),
	});
	await expect(
		renderFramePngRequest({ api: mock.value, resources, frame, handle: 1 }),
	).rejects.toThrow("Invalid native frame PNG");
	expect(mock.calls.at(-1)).toBe("cancel");
});
const resources: Args["resources"] = {
	setTimeout({ handler, ms }) {
		const timer = setTimeout(handler, ms);
		return {
			resourceId: "async-test" as ReturnType<
				Args["resources"]["setTimeout"]
			>["resourceId"],
			kind: "timeout",
			cancel: () => clearTimeout(timer),
		};
	},
};
function deferred() {
	let resolve!: (value: boolean) => void, reject!: (error: Error) => void;
	const promise = new Promise<boolean>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function api(advance: RenderFrameRequestApi["advanceRenderFrameForHandle"]) {
	const calls: string[] = [];
	const value: RenderFrameRequestApi = {
		beginRenderFrameForHandle: () => {
			calls.push("begin");
			return 7;
		},
		advanceRenderFrameForHandle: advance,
		commitRenderFrameForHandle: () => {
			calls.push("commit");
		},
		cancelRenderFrameForHandle: () => {
			calls.push("cancel");
		},
	};
	return { value, calls };
}
test("async advance must resolve ready before commit", async () => {
	const pending = deferred(),
		mock = api(() => pending.promise);
	const task = renderFrameRequest({
		api: mock.value,
		resources,
		frame,
		handle: 1,
	});
	await Promise.resolve();
	expect(mock.calls).toEqual(["begin"]);
	pending.resolve(true);
	await task;
	expect(mock.calls).toEqual(["begin", "commit"]);
	const synchronous = api(() => true);
	const immediate = renderFrameRequest({
		api: synchronous.value,
		resources,
		frame,
		handle: 1,
	});
	// A plain boolean must not introduce an await/microtask before commit.
	expect(synchronous.calls).toEqual(["begin", "commit"]);
	await immediate;
});
test("abort during async advance cancels immediately and late true cannot commit", async () => {
	const pending = deferred(),
		mock = api(() => pending.promise),
		abort = new AbortController();
	const task = renderFrameRequest({
		api: mock.value,
		resources,
		frame,
		handle: 1,
		signal: abort.signal,
	});
	abort.abort();
	expect(mock.calls).toEqual(["begin", "cancel"]);
	pending.resolve(true);
	await expect(task).rejects.toMatchObject({ code: "RENDER_CANCELLED" });
	expect(mock.calls).toEqual(["begin", "cancel"]);
});
test("replacement identity after await prevents commit and drains old request", async () => {
	const pending = deferred(),
		mock = api(() => pending.promise);
	let current = true;
	const task = renderFrameRequest({
		api: mock.value,
		resources,
		frame,
		handle: 1,
		assertCurrent: () => {
			if (!current) throw new Error("replaced");
		},
	});
	current = false;
	pending.resolve(true);
	await expect(task).rejects.toThrow("replaced");
	expect(mock.calls).toEqual(["begin", "cancel"]);
});
test("async rejection is terminal and cancels only this request", async () => {
	const pending = deferred(),
		mock = api(() => pending.promise);
	const task = renderFrameRequest({
		api: mock.value,
		resources,
		frame,
		handle: 1,
	});
	pending.reject(new Error("capture failed"));
	await expect(task).rejects.toThrow("capture failed");
	expect(mock.calls).toEqual(["begin", "cancel"]);
});
test("false async chunk yields a task and old synchronous API still works", async () => {
	let count = 0;
	const mock = api(() => (++count === 1 ? Promise.resolve(false) : true));
	await renderFrameRequest({ api: mock.value, resources, frame, handle: 1 });
	expect(count).toBe(2);
	expect(mock.calls).toEqual(["begin", "commit"]);
});
