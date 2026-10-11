import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const repository =
	process.env.LIQUID_REPO_ROOT ?? resolve(fixtureDirectory, "../..");
const { build, transform } = createRequire(resolve(repository, "package.json"))(
	"esbuild",
);
const released = [];
const dependencies = {
	"opencut-wasm":
		"export const disposeCompositor = (handle) => globalThis.__liquidCpuRelease(handle);",
	"wasm-compositor":
		"export class WasmCompositor { constructor(resources) { this.resources = resources; } }",
	"scene-builder":
		"export const buildScene = () => { throw Error('Scene construction is not used by this CPU resource regression'); };",
	"media-time": "export const mediaTime = (time) => time;",
	"stylized-probe-scene":
		"export const assert = () => {}; export const hash = () => {}; export const effect = () => {};",
};
globalThis.__liquidCpuRelease = (handle) => released.push(handle);

async function loadResources(path) {
	const result = await build({
		stdin: {
			contents: await readFile(path, "utf8"),
			sourcefile: path,
			loader: "ts",
			resolveDir: dirname(path),
		},
		bundle: true,
		write: false,
		format: "esm",
		platform: "node",
		plugins: [
			{
				name: "cpu-only-fixture-dependencies",
				setup(builder) {
					builder.onResolve({ filter: /.*/ }, (args) => {
						const key = Object.keys(dependencies).find(
							(name) => args.path === name || args.path.endsWith("/" + name),
						);
						if (!key)
							throw Error("Unexpected CPU fixture dependency: " + args.path);
						return { path: key, namespace: "cpu-stub" };
					});
					builder.onLoad({ filter: /.*/, namespace: "cpu-stub" }, (args) => ({
						contents: dependencies[args.path],
						loader: "js",
					}));
				},
			},
		],
	});
	const module = await import(
		"data:text/javascript;base64," +
			Buffer.from(result.outputFiles[0].text).toString("base64")
	);
	return module.spatialParams().compositor.resources;
}

const resources = await loadResources(
	resolve(fixtureDirectory, "spatial-probe-scene.ts"),
);
const requestSource = resolve(
	repository,
	"packages/editor-classic/src/services/renderer/compositor/render-request.ts",
);
const request = await transform(await readFile(requestSource, "utf8"), {
	loader: "ts",
	format: "cjs",
	sourcefile: requestSource,
});
const requestModule = { exports: {} };
new Function(
	"module",
	request.code +
		"\n//# sourceURL=" +
		requestSource.replaceAll("\\\\", "/") +
		"?cpu-transpiled",
)(requestModule);
const { renderFrameRequest, yieldRenderTask } = requestModule.exports;
const frame = { width: 1, height: 1, time: 0 };
function fakeApi(advance) {
	const calls = [];
	return {
		calls,
		beginRenderFrameForHandle: () => {
			calls.push("begin");
			return 7;
		},
		advanceRenderFrameForHandle: (...args) => {
			calls.push(["advance", ...args]);
			return advance();
		},
		commitRenderFrameForHandle: () => calls.push("commit"),
		cancelRenderFrameForHandle: () => calls.push("cancel"),
	};
}

test("fixture provides a cancellable real task rather than a microtask", async () => {
	const order = [];
	const pending = yieldRenderTask({ resources }).then(() => order.push("task"));
	await Promise.resolve().then(() => order.push("microtask"));
	assert.deepEqual(order, ["microtask"]);
	await pending;
	assert.deepEqual(order, ["microtask", "task"]);
	const timer = resources.setTimeout({
		ms: 0,
		handler: () => order.push("cancelled"),
	});
	assert.equal(timer.kind, "timeout");
	assert.equal(typeof timer.resourceId, "string");
	timer.cancel();
	await yieldRenderTask({ resources });
	assert.deepEqual(order, ["microtask", "task"]);
});

test("production request yields each incomplete chunk with unchanged zero ms and one step", async () => {
	let advances = 0;
	const milliseconds = [];
	const api = fakeApi(() => ++advances === 3);
	const observed = {
		setTimeout(args) {
			milliseconds.push(args.ms);
			return resources.setTimeout(args);
		},
	};
	await renderFrameRequest({ api, resources: observed, handle: 4, frame });
	assert.deepEqual(milliseconds, [0, 0]);
	assert.deepEqual(api.calls, [
		"begin",
		["advance", 4, 7, 1],
		["advance", 4, 7, 1],
		["advance", 4, 7, 1],
		"commit",
	]);
});

test("abort cancels the real fixture timer and request without another advance or commit", async () => {
	const controller = new AbortController();
	const api = fakeApi(() => false);
	let cancellations = 0,
		handlers = 0;
	const observed = {
		setTimeout(args) {
			const timer = resources.setTimeout({
				...args,
				handler: () => {
					handlers++;
					args.handler();
				},
			});
			return {
				...timer,
				cancel() {
					cancellations++;
					timer.cancel();
				},
			};
		},
	};
	const pending = renderFrameRequest({
		api,
		resources: observed,
		handle: 4,
		frame,
		signal: controller.signal,
	});
	controller.abort();
	await assert.rejects(
		pending,
		(error) => error.name === "AbortError" && error.code === "RENDER_CANCELLED",
	);
	await yieldRenderTask({ resources });
	assert.equal(cancellations, 1);
	assert.equal(handlers, 0);
	assert.deepEqual(api.calls, ["begin", ["advance", 4, 7, 1], "cancel"]);
});

test("immediately ready request neither schedules a task nor changes commit order", async () => {
	const api = fakeApi(() => true);
	await renderFrameRequest({
		api,
		resources: {
			setTimeout() {
				throw Error("Unexpected yield");
			},
		},
		handle: 4,
		frame,
	});
	assert.deepEqual(api.calls, ["begin", ["advance", 4, 7, 1], "commit"]);
});

test("fixture keeps the GPU release handle and label contract", () => {
	const handle = resources.trackGpuResource({ handle: 19, label: "CPU mock" });
	assert.equal(handle.handle, 19);
	assert.equal(handle.label, "CPU mock");
	assert.equal(handle.resourceId, "spatial:19");
	handle.release();
	assert.deepEqual(released, [19]);
});

if (process.env.LIQUID_ORIGINAL_FIXTURE) {
	test("original frozen fixture reproduces the first scene exception with production stack", async () => {
		const original = await loadResources(process.env.LIQUID_ORIGINAL_FIXTURE);
		const api = fakeApi(() => false);
		let failure;
		try {
			await renderFrameRequest({ api, resources: original, handle: 4, frame });
		} catch (error) {
			failure = error;
		}
		assert.equal(
			String(failure),
			"TypeError: resources.setTimeout is not a function",
		);
		assert.deepEqual(api.calls, ["begin", ["advance", 4, 7, 1], "cancel"]);
		// The original JSON omitted this inner-catch stack; this is CPU reproduction,
		// not a reconstruction of the browser's unavailable stack.
		console.log("CPU_ORIGINAL_STACK " + JSON.stringify(failure.stack));
	});
}
