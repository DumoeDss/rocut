import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";

const repo =
	process.env.ROCUT_GLASS_BOOTSTRAP_REPO ??
	resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const probePath =
	process.env.ROCUT_GLASS_BOOTSTRAP_PROBE_PATH ??
	join(repo, "script/probe-glass-object-editor-export.mjs");
const source = new TextDecoder("utf-8", { fatal: true }).decode(
	await readFile(probePath),
);
const expressions = [
	...source.matchAll(
		/await writeFile\(join\(input,'index\.html'\),(.+),\{flag:'wx'\}\);/g,
	),
];
assert.equal(
	expressions.length,
	1,
	"Test the actual production bootstrap HTML expression",
);
const html = runInNewContext(expressions[0][1], { JSON, join, repo });
const body = /<script type="module">([\s\S]+)<\/script>/.exec(html)?.[1];
assert.equal(typeof body, "string");
const fixturePath = join(
	repo,
	"script/fixtures/glass-object-editor-export-browser.ts",
).replaceAll("\\", "/");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Execute the exact emitted module body with CPU-only import and global seams.
// No browser, fake rasterization, changed WASM bytes, or production export claim.
function execute(code, load, target = {}) {
	return new AsyncFunction(
		"load",
		"target",
		code.replaceAll("import(", "load(").replaceAll("globalThis", "target"),
	)(load, target);
}

function deferred() {
	let resolve;
	const promise = new Promise((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}

test("web async initialization finishes before fixture evaluation and readiness", async () => {
	const gate = deferred(),
		entered = deferred(),
		events = [],
		target = {};
	const run = () => {};
	let ready = false;
	const pending = execute(
		body,
		async (id) => {
			events.push(id);
			if (id === "opencut-wasm")
				return {
					default: async () => {
						events.push("init-entered");
						entered.resolve();
						await gate.promise;
						ready = true;
						events.push("init-complete");
					},
				};
			assert.equal(id, fixturePath);
			assert.equal(ready, true, "Eager Rust constant access must follow init");
			return { runGlassEditorExport: run };
		},
		target,
	);
	await entered.promise;
	assert.deepEqual(events, ["opencut-wasm", "init-entered"]);
	assert.equal(target.__glassExportRun, undefined);
	gate.resolve();
	await pending;
	assert.deepEqual(events, [
		"opencut-wasm",
		"init-entered",
		"init-complete",
		fixturePath,
	]);
	assert.equal(target.__glassExportRun, run);
});

test("canonical bundler auto-initialized namespace needs no default initializer", async () => {
	const events = [],
		target = {},
		run = () => {};
	const canonical = { TICKS_PER_SECOND: () => 120000 };
	assert.equal("default" in canonical, false);
	await execute(
		body,
		async (id) => {
			events.push(id);
			if (id === "opencut-wasm") return canonical;
			assert.equal(id, fixturePath);
			assert.equal(canonical.TICKS_PER_SECOND(), 120000);
			return { runGlassEditorExport: run };
		},
		target,
	);
	assert.deepEqual(events, ["opencut-wasm", fixturePath]);
	assert.equal(target.__glassExportRun, run);
});

test("WASM import failure prevents fixture import and readiness", async () => {
	const failure = new Error("WASM import failed"),
		events = [],
		target = {};
	await assert.rejects(
		execute(
			body,
			async (id) => {
				events.push(id);
				throw failure;
			},
			target,
		),
		(error) => error === failure,
	);
	assert.deepEqual(events, ["opencut-wasm"]);
	assert.equal(target.__glassExportRun, undefined);
});

test("async initializer failure prevents fixture import and readiness", async () => {
	const failure = new Error("actual initialization failed"),
		events = [],
		target = {};
	await assert.rejects(
		execute(
			body,
			async (id) => {
				events.push(id);
				return {
					default: async () => {
						events.push("init-failed");
						throw failure;
					},
				};
			},
			target,
		),
		(error) => error === failure,
	);
	assert.deepEqual(events, ["opencut-wasm", "init-failed"]);
	assert.equal(target.__glassExportRun, undefined);
});

test("fixture evaluation failure cannot advertise a ready export function", async () => {
	const failure = new Error("fixture failed"),
		target = {};
	await assert.rejects(
		execute(
			body,
			async (id) => {
				if (id === "opencut-wasm") return { default: async () => {} };
				throw failure;
			},
			target,
		),
		(error) => error === failure,
	);
	assert.equal(target.__glassExportRun, undefined);
});

test("legacy import-only bootstrap reproduces uninitialized constant failure", async () => {
	let initialized = false;
	const target = {},
		legacy = `await import("opencut-wasm");globalThis.__glassExportRun=(await import(${JSON.stringify(fixturePath)})).runGlassEditorExport;`;
	await assert.rejects(
		execute(
			legacy,
			async (id) => {
				if (id === "opencut-wasm")
					return {
						default: async () => {
							initialized = true;
						},
					};
				if (!initialized)
					throw new TypeError(
						"Cannot read properties of undefined (reading 'TICKS_PER_SECOND')",
					);
				return { runGlassEditorExport() {} };
			},
			target,
		),
		/TICKS_PER_SECOND/,
	);
	assert.equal(initialized, false);
	assert.equal(target.__glassExportRun, undefined);
});

test("full duration remains 49 frames and no synchronous compilation override is added", () => {
	assert.match(
		source,
		/const frameWindow=fullDuration\?\{startFrame:0,frameCount:49\}:\{startFrame:8,frameCount:4\}/,
	);
	assert.match(source, /ROCUT_GLASS_EXPORT_FULL==='1'/);
	assert.equal(source.includes("UnlimitedSyncCompilation"), false);
	assert.equal(body.includes("initSync"), false);
});
