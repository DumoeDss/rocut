import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, basename } from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "../browser-probe-toolchain.mjs";
import {
	installGlassWasmObserver,
	assertGlassBrowserIdentity,
} from "./glass-current-baseline-observer.mjs";

const receipt = process.env.ROCUT_GLASS_BROWSER_PIN_RECEIPT;
const expectedSha256 = process.env.ROCUT_GLASS_EXPECTED_WASM_SHA256;
assert(
	isAbsolute(receipt ?? "") &&
		/^browser-pins-(editor|export)\.json$/.test(basename(receipt)),
);
assert(/^[a-f0-9]{64}$/.test(expectedSha256 ?? ""));
const owner = await lstat(dirname(receipt));
assert(owner.isDirectory() && !owner.isSymbolicLink());
// The legacy editor probe creates a Bun Host, not a Playwright browser. Give
// that process its own explicit byte/initializer/resolver receipt before its
// existing local-wasm binding preload. Do not imply this observes its Chromium.
const spawn = childProcess.spawn;
childProcess.spawn = function (executable, args, options) {
	if (args?.includes("script/fixtures/glass-editor-host.ts")) {
		args = [
			"--preload",
			fileURLToPath(
				new URL("./glass-current-baseline-host-pins.mjs", import.meta.url),
			),
			...args,
		];
	}
	return spawn.call(this, executable, args, options);
};
syncBuiltinESMExports();
const report = {
	ok: false,
	pid: process.pid,
	expectedSha256,
	startedAt: new Date().toISOString(),
	role: basename(receipt).includes("editor")
		? "Node Playwright editor browser"
		: "Node Playwright production-export compositor browser",
	servedCollection:
		"actual .wasm Response.clone() bytes in pre-application observer; not inspector cache or URL identity",
	served: [],
	loaded: [],
	fontsServed: [],
	errors: [],
	limitations: [
		"Does not observe Host Bun standalone capture browsers or synchronous WebAssembly constructors.",
		"Unknown precompiled modules are recorded as unknown, never promoted to loaded byte identity.",
	],
};
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...args) => {
	const pending = new Set(),
		contexts = new WeakSet(),
		pages = new WeakSet();
	let browser;
	try {
		browser = await launch(...args);
		report.browserVersion = browser.version();
		const preparePage = (page) => {
			if (pages.has(page)) return;
			pages.add(page);
			page.on("response", (response) => {
				const path = new URL(response.url()).pathname;
				// Fonts retain independent response-body collection. WASM uses the
				// actual consumed Response clone, so large binary cache eviction is
				// not silently ignored or reclassified as a success.
				if (!/\/(?:fonts|motion-text\/fonts)\//.test(path)) return;
				const job = (async () => {
					const bytes = await response.body();
					const item = {
						asset: path.split("/").at(-1),
						status: response.status(),
						bytes: bytes.length,
						sha256: createHash("sha256").update(bytes).digest("hex"),
					};
					report.fontsServed.push(item);
				})().catch((error) =>
					report.errors.push(
						String(error).replace(/https?:\/\/[^\s"'<>]+/g, "[private URL]"),
					),
				);
				pending.add(job);
				void job.finally(() => pending.delete(job));
			});
		};
		const prepareContext = async (context) => {
			if (contexts.has(context)) return;
			contexts.add(context);
			await context.exposeBinding("__rocutGlassWasmPin", (_source, entry) => {
				if (entry.kind === "served") report.served.push(entry);
				else if (entry.kind === "loaded") report.loaded.push(entry);
				else if (entry.kind === "error") report.errors.push(entry);
				else report.errors.push({ message: "Unknown observer event kind" });
			});
			await context.addInitScript(installGlassWasmObserver);
			context.on("page", preparePage);
			for (const page of context.pages()) preparePage(page);
		};
		const newContext = browser.newContext.bind(browser);
		browser.newContext = async (...options) => {
			const context = await newContext(...options);
			await prepareContext(context);
			return context;
		};
		const newPage = browser.newPage.bind(browser);
		browser.newPage = async (...options) => {
			const page = await newPage(...options);
			await prepareContext(page.context());
			preparePage(page);
			return page;
		};
		const close = browser.close.bind(browser);
		browser.close = async (...options) => {
			await Promise.all([...pending]);
			try {
				await close(...options);
			} finally {
				try {
					report.identity = assertGlassBrowserIdentity(report, expectedSha256);
					report.ok = true;
				} catch (error) {
					report.failure = String(error);
				}
				report.finishedAt = new Date().toISOString();
				await writeFile(receipt, JSON.stringify(report, null, 2) + "\n", {
					flag: "wx",
				});
			}
		};
		return browser;
	} catch (error) {
		report.failure = String(error);
		report.finishedAt = new Date().toISOString();
		await writeFile(receipt, JSON.stringify(report, null, 2) + "\n", {
			flag: "wx",
		});
		throw error;
	}
};
