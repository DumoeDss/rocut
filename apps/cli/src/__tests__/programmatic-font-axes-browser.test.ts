import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ProgrammaticResource } from "@opencut/editor-contracts";
import { FileProjectStore } from "../file-store";
import { importProgrammaticResource } from "../programmatic/resource-import";
import { loadProgrammaticResource } from "../programmatic/resources";
import { launchFrameBrowser } from "../programmatic/chromium-process";
import { renderHtmlPng } from "../programmatic/html-rasterizer";
import { variableFontFixture } from "../../../../script/fixtures/programmatic-font-axes-fixture";

const wasmDirectory = process.env.ROCUT_TEST_WASM_DIRECTORY;
test.skipIf(!wasmDirectory)(
	"variable font axes drive real Worker and HTML glyphs after offline resource reopen, with descriptor-aware frame caches",
	async () => {
		const parent = resolve(tmpdir()),
			evidence = await mkdtemp(join(parent, "rocut-font-axes-browser-"));
		const work = join(evidence, "work"),
			author = join(work, "author");
		await mkdir(author, { recursive: true });
		const storeOptions = { root: join(work, "project"), schemaVersion: 1 };
		let context = {
			store: new FileProjectStore(storeOptions),
			projectId: "font-axes",
		};
		const custom = await variableFontFixture("XTRA"),
			escaped = await variableFontFixture('A"\\Z');
		const original = fileURLToPath(
			new URL(
				"../../../../apps/web/public/motion-text/fonts/noto-sans-jp-variable.ttf",
				import.meta.url,
			),
		);
		const staticFont = fileURLToPath(
			new URL(
				"../../../../apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf",
				import.meta.url,
			),
		);
		const paths = {
			custom: join(author, "custom.ttf"),
			escaped: join(author, "escaped.ttf"),
			original: join(author, "original.ttf"),
			static: join(author, "static.ttf"),
		};
		await writeFile(paths.custom, custom);
		await writeFile(paths.escaped, escaped);
		await writeFile(paths.original, await readFile(original));
		await writeFile(paths.static, await readFile(staticFont));
		const resources: Record<string, ProgrammaticResource> = {};
		for (const [key, filePath, axes] of [
			["low", paths.custom, { XTRA: 100 }],
			["high", paths.custom, { XTRA: 900 }],
			["escaped", paths.escaped, { 'A"\\Z': 900 }],
			["originalLow", paths.original, { wght: 100 }],
			["originalHigh", paths.original, { wght: 900 }],
			["static", paths.static, undefined],
		] as const) {
			resources[key] = (
				await importProgrammaticResource({
					...context,
					input: {
						filePath,
						id: "font.ttf",
						kind: "font",
						mimeType: "font/ttf",
						font: {
							family: "RocutVariableFixture",
							style: "normal",
							weight: 400,
							...(axes ? { axes } : {}),
						},
					},
				})
			).resource;
		}
		expect(resources.low!.attachmentKey).toBe(resources.high!.attachmentKey);
		await writeFile(
			join(work, "resources.json"),
			JSON.stringify(resources),
			"utf8",
		);
		await rename(author, join(work, "unavailable-author"));
		context = {
			store: new FileProjectStore(storeOptions),
			projectId: "font-axes",
		};
		const reopened = JSON.parse(
			await readFile(join(work, "resources.json"), "utf8"),
		);
		expect(reopened).toEqual(resources);
		const require = createRequire(
			new URL("../../../vite-example/package.json", import.meta.url),
		);
		const { chromium } = await import(
			pathToFileURL(require.resolve("@playwright/test")).href
		);
		const executable = chromium.executablePath();
		const built = await Bun.build({
			entrypoints: [
				fileURLToPath(
					new URL(
						"../../../../script/fixtures/programmatic-font-axes-browser.ts",
						import.meta.url,
					),
				),
			],
			target: "browser",
			format: "esm",
			plugins: [
				{
					name: "private-font-axes-wasm",
					setup(build) {
						build.onResolve({ filter: /^opencut-wasm$/ }, () => ({
							path: "/wasm-js",
							external: true,
						}));
					},
				},
			],
		});
		if (!built.success || built.outputs.length !== 1)
			throw Error(`Font probe bundle failed: ${built.logs}`);
		const bundle = await built.outputs[0]!.text(),
			wasmJs = await readFile(join(wasmDirectory!, "opencut_wasm.js"), "utf8"),
			wasmBytes = await readFile(join(wasmDirectory!, "opencut_wasm_bg.wasm"));
		const controller = new AbortController(),
			timer = setTimeout(
				() => controller.abort(Error("Font probe deadline")),
				110000,
			);
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				try {
					switch (new URL(request.url).pathname) {
						case "/":
							return new Response(
								'<!doctype html><meta charset="utf-8"><script type="module">import init from "/wasm-js"; await init({module_or_path:fetch("/wasm")}); await import("/bundle.js");</script>',
								{ headers: { "content-type": "text/html; charset=utf-8" } },
							);
						case "/bundle.js":
							return new Response(bundle, {
								headers: { "content-type": "text/javascript" },
							});
						case "/wasm":
							return new Response(wasmBytes, {
								headers: { "content-type": "application/wasm" },
							});
						case "/wasm-js":
							return new Response(wasmJs, {
								headers: { "content-type": "text/javascript" },
							});
						case "/config":
							return Response.json(reopened);
						case "/resource": {
							const resource = (await request.json()) as ProgrammaticResource;
							const loaded = await loadProgrammaticResource({
								...context,
								resource,
							});
							return new Response(loaded.body, {
								headers: { "content-type": resource.mimeType },
							});
						}
						case "/frame": {
							const body = await request.json();
							return new Response(
								new Uint8Array(
									await renderHtmlPng({
										executable,
										connectionFile: "",
										request: body,
										signal: controller.signal,
										resourceStore: context,
									}),
								),
								{ headers: { "content-type": "image/png" } },
							);
						}
						default:
							return new Response("Missing fixture route", { status: 404 });
					}
				} catch (error) {
					return new Response(String(error), { status: 500 });
				}
			},
		});
		let browser: Awaited<ReturnType<typeof launchFrameBrowser>> | undefined;
		try {
			browser = await launchFrameBrowser(executable, controller.signal);
			const { targetId } = await browser.send("Target.createTarget", {
				url: "about:blank",
			});
			const { sessionId } = await browser.send("Target.attachToTarget", {
				targetId,
				flatten: true,
			});
			const send = (method: string, params = {}) =>
				browser!.send(method, params, String(sessionId));
			const diagnostics: unknown[] = [];
			browser.onEvent((event) => {
				if (
					event.sessionId === sessionId &&
					event.method === "Runtime.exceptionThrown"
				)
					diagnostics.push(event.params);
			});
			await send("Page.enable");
			await send("Runtime.enable");
			await send("Network.enable");
			await send("Network.setBlockedURLs", {
				urls: ["https://*", "file://*", "ftp://*", "ws://*", "wss://*"],
			});
			const loaded = new Promise<void>((resolveLoaded) => {
				const off = browser!.onEvent((event) => {
					if (
						event.sessionId === sessionId &&
						event.method === "Page.loadEventFired"
					) {
						off();
						resolveLoaded();
					}
				});
			});
			await send("Page.navigate", { url: server.url.href });
			await loaded;
			const result = await send("Runtime.evaluate", {
				expression:
					"new Promise((resolve, reject) => {const until=Date.now()+10000; function poll(){ if(window.rocutFontAxesResult) resolve(window.rocutFontAxesResult); else if(Date.now()>until) reject(Error('Font fixture did not initialize')); else setTimeout(poll,20); } poll();})",
				awaitPromise: true,
				returnByValue: true,
			});
			if (result.exceptionDetails)
				throw Error(
					JSON.stringify({ exception: result.exceptionDetails, diagnostics }),
				);
			const value = (result.result as { value: Record<string, unknown> }).value;
			await writeFile(
				join(evidence, "verification.json"),
				JSON.stringify(
					{
						...value,
						browser: await browser.send("Browser.getVersion"),
						wasmSha256: createHash("sha256").update(wasmBytes).digest("hex"),
						fixture: {
							source:
								"apps/web/public/motion-text/fonts/noto-sans-jp-variable.ttf",
							license:
								"apps/web/public/motion-text/fonts/licenses/notosansjp-OFL.txt",
							modifications:
								"Private fvar/STAT axis-tag rename plus table/file checksum updates; font files removed after this test; never redistributed",
							customSha256: createHash("sha256").update(custom).digest("hex"),
							escapedSha256: createHash("sha256").update(escaped).digest("hex"),
						},
					},
					null,
					2,
				),
				"utf8",
			);
			console.log(`Variable font evidence: ${evidence}`);
			expect(value.error).toBeUndefined();
			expect(value.ok).toBe(true);
		} finally {
			controller.abort();
			clearTimeout(timer);
			await browser?.close();
			await server.stop(true);
			if (
				dirname(evidence) !== parent ||
				!basename(evidence).startsWith("rocut-font-axes-browser-") ||
				dirname(work) !== evidence ||
				basename(work) !== "work"
			)
				throw Error("Unsafe font probe cleanup");
			await rm(work, { recursive: true, force: true });
		}
	},
	120000,
);
