import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

/** Load only this responsibility's actual body, with CPU-only imported seams. */
async function load({ name, dependencies, exportName }) {
	const source = await readFile(
		new URL(`./particle-editor-launcher-${name}.mjs`, import.meta.url),
		"utf8",
	);
	const executable = source
		.replace(/^import[\s\S]*?from "[^"\n]+";\n/gm, "")
		.replaceAll("export async function", "async function");
	return runInNewContext(`${executable}\n${exportName}`, {
		assert: {
			...assert,
			deepEqual: (actual, expected, message) =>
				assert.deepEqual(
					structuredClone(actual),
					structuredClone(expected),
					message,
				),
		},
		join,
		resolve,
		URL,
		AbortSignal,
		Buffer,
		console,
		...dependencies,
	});
}

test("launcher closure records every extracted source and rejects changed input bytes", async () => {
	let suffix = "initial";
	const remember = await load({
		name: "preflight",
		exportName: "rememberParticleLauncherSources",
		dependencies: {
			readFile: async (path) => Buffer.from(path + suffix),
			hash: (bytes) => createHash("sha256").update(bytes).digest("hex"),
		},
	});
	const sources = new Map();
	await remember({ repo: "C:/external-projection", sources });
	assert.equal(sources.size, 4);
	assert.deepEqual(
		[...sources.keys()].map((path) => path.split(/[\\/]/).at(-1)),
		[
			"particle-editor-launcher-preflight.mjs",
			"particle-editor-launcher-browser-session.mjs",
			"particle-editor-launcher-handoff.mjs",
			"particle-editor-launcher-refactor.test.mjs",
		],
	);
	await remember({ repo: "C:/external-projection", sources });
	suffix = "changed";
	await assert.rejects(
		remember({ repo: "C:/external-projection", sources }),
		/Launcher input changed/,
	);
});

test("browser resource remains visible to original finally when newPage fails", async () => {
	const browser = {
		newPage: async () => {
			throw Error("page failure");
		},
	};
	const run = await load({
		name: "browser-session",
		exportName: "runParticleEditorBrowserSession",
		dependencies: { chromium: { launch: async () => browser } },
	});
	const session = {};
	await assert.rejects(
		run({
			ready: { editorUrl: "http://127.0.0.1/editor" },
			options: {},
			session,
		}),
		/page failure/,
	);
	assert.equal(session.browser, browser);
	assert.equal(session.browserPage, undefined);
});

test("page resource remains visible if authority initialization fails", async () => {
	const page = {
		addInitScript: async () => {
			throw Error("observer failure");
		},
	};
	const browser = { newPage: async () => page };
	const run = await load({
		name: "browser-session",
		exportName: "runParticleEditorBrowserSession",
		dependencies: {
			chromium: { launch: async () => browser },
			installParticleAuthorityBrowserObserver() {},
		},
	});
	const session = {};
	await assert.rejects(
		run({
			ready: { editorUrl: "http://127.0.0.1/editor" },
			options: {},
			session,
			authority: { metadata: { nativeAuthority: {} } },
		}),
		/observer failure/,
	);
	assert.equal(session.browser, browser);
	assert.equal(session.browserPage, page);
});

test("browser retains launch waits, internal request deadline and legacy network gates", async () => {
	const handlers = {},
		evidence = {
			errors: [],
			consoleErrors: [],
			httpFailures: [],
			externalRequests: [],
		};
	let routeHandler, launchOptions, gotoOptions, waitOptions, requested;
	const page = {
		on: (...args) => {
			const [name, handler] = args;
			handlers[name] = handler;
		},
		route: async (...args) => {
			const [, handler] = args;
			routeHandler = handler;
		},
		goto: async (...args) => {
			const [, options] = args;
			gotoOptions = options;
		},
		locator: () => ({
			waitFor: async (options) => {
				waitOptions = options;
			},
		}),
	};
	const frames = { requests: [121] };
	const browser = { newPage: async () => page, version: () => "cpu-browser" };
	const run = await load({
		name: "browser-session",
		exportName: "runParticleEditorBrowserSession",
		dependencies: {
			chromium: {
				launch: async (options) => {
					launchOptions = options;
					return browser;
				},
			},
			fetch: async (url, options) => {
				requested = { url, options };
				return { ok: true, json: async () => ({ surfaces: 1 }) };
			},
			observeParticleFrames: () => frames,
			poll: async (predicate) => assert.equal(await predicate(), true),
			runParticleEditorChecks: async (input) =>
				assert.equal(input.frames, frames),
		},
	});
	await run({
		ready: { editorUrl: "http://127.0.0.1/editor/?token=private" },
		options: { chromium: "browser" },
		root: "fixture",
		evidence,
		session: {},
		redact: () => "redacted",
	});
	assert.equal(launchOptions.timeout, 60000);
	assert.equal(gotoOptions.timeout, 60000);
	assert.equal(gotoOptions.waitUntil, "load");
	assert.equal(waitOptions.timeout, 60000);
	assert.ok(requested.options.signal instanceof AbortSignal);
	handlers.response({
		status: () => 404,
		url: () => "http://127.0.0.1/api/library/graph-editor-presets/user-presets",
	});
	assert.equal(evidence.httpFailures.length, 0);
	handlers.response({
		status: () => 404,
		url: () => "http://127.0.0.1/missing",
	});
	assert.equal(evidence.httpFailures.length, 1);
	let aborted = false,
		continued = false;
	await routeHandler({
		request: () => ({ url: () => "https://outside.invalid/x" }),
		abort: async () => {
			aborted = true;
		},
	});
	await routeHandler({
		request: () => ({ url: () => "http://127.0.0.1/x" }),
		continue: async () => {
			continued = true;
		},
	});
	assert.equal(aborted, true);
	assert.equal(continued, true);
	assert.equal(evidence.externalRequests[0], "https://outside.invalid");
});

test("handoff cannot pass run mode before direct child and reopened-state gates", async () => {
	let writes = 0;
	const finish = await load({
		name: "handoff",
		exportName: "finishParticleEditorHandoff",
		dependencies: {
			readJson: async () => ({ allObservedDirectChildrenClosed: false }),
			writeJson: async () => {
				writes++;
			},
		},
	});
	await assert.rejects(
		finish({
			options: { mode: "run" },
			root: "fixture",
			evidence: {},
			secrets: new Set(),
		}),
	);
	assert.equal(writes, 0);
});

test("build-only handoff keeps export untouched and rejects retained capability bytes", async () => {
	const writes = [];
	const finish = await load({
		name: "handoff",
		exportName: "finishParticleEditorHandoff",
		dependencies: {
			particleEditorContract: {},
			hash: () => "digest",
			readFile: async () => Buffer.from("private-token"),
			treeManifest: async () => ({ files: [{ path: "leak.txt" }] }),
			writeJson: async (path) => {
				writes.push(path);
			},
			console: { log() {} },
		},
	});
	const evidence = { exportTested: false };
	await assert.rejects(
		finish({
			options: { mode: "build-only" },
			root: "fixture",
			evidence,
			secrets: new Set(["private-token"]),
		}),
		/Known private capability/,
	);
	assert.equal(writes.length, 0);
	assert.equal(evidence.exportTested, false);
	await finish({
		options: { mode: "build-only" },
		root: "fixture",
		evidence,
		secrets: new Set(),
	});
	assert.equal(evidence.status, "build-only-passed");
	assert.deepEqual(writes, [join("fixture", "evidence.json")]);
});
