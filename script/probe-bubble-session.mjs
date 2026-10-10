import { mkdir, mkdtemp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { collectBubbleInputs, verifyBubbleInputs, bubbleSourceGuard } from "./probe-bubble-evidence.mjs";
import { bubbleDeadline, bubbleSaveJson, captureBubble } from "./probe-bubble-artifacts.mjs";
import { pinBubbleWasmHelper, watchBubbleLoading } from "./probe-bubble-loading.mjs";

export async function runBubbleSession({ root, packageDirectory, parent, executablePath, diagnostic, runnerDirectory, plan,
	loadToolchain = () => import("./browser-probe-toolchain.mjs") }) {
	const artifacts = await mkdtemp(join(parent, diagnostic ? "bubble-diagnostic-" : "bubble-default-"));
	const temp = join(artifacts, "temp");
	const report = {
		ok: false, kind: "bubble-raster", diagnostic, artifacts, requestedBackend: "webgl",
		startedAt: new Date().toISOString(), outerTimeoutMs: 900000,
		console: [], pageErrors: [], httpErrors: [], requestFailures: [], externalRequests: [], captureErrors: [],
		checks: null, browserClosed: false, serverClosed: false,
	};
	let server, context, page, frozen, guard, loading, closing = false;
	// A late resource creation must close its own resource, never leak after the
	// outer deadline. No global process enumeration or other-session termination.
	async function owned(promise, close, label) {
		const ownedPromise = promise.then(async (resource) => {
			if (closing) {
				await close(resource);
				throw Error(`${label} completed after session deadline and was closed`);
			}
			return resource;
		});
		return bubbleDeadline(ownedPromise, 45000, label);
	}
	try {
		await mkdir(temp);
		frozen = await collectBubbleInputs(root, packageDirectory, runnerDirectory);
		Object.assign(report, { frozen });
		const work = async () => {
			const { chromium, createServer, topLevelAwait, wasm } = await loadToolchain();
			const { liquidDiagnosticWasmRoute } = await import("./liquid-diagnostic-wasm.mjs");
			if (closing) throw Error("Bubble session already closing");
			const wasmPlugin = wasm();
			report.virtualProviders = [await pinBubbleWasmHelper(wasmPlugin)];
			guard = bubbleSourceGuard(frozen, dirname(runnerDirectory), report.virtualProviders);
			server = await owned(createServer({
				root, configFile: false, cacheDir: join(artifacts, "vite-cache"), logLevel: "error",
				plugins: [guard.plugin, wasmPlugin, topLevelAwait(), await liquidDiagnosticWasmRoute(packageDirectory)],
				optimizeDeps: { noDiscovery: true, include: [] },
				resolve: { alias: { "opencut-wasm": join(packageDirectory, "opencut_wasm.js") } },
				server: { host: "127.0.0.1", port: 0, hmr: false,
					fs: { strict: true, allow: [root, packageDirectory, join(runnerDirectory, "../node_modules")] } },
			}), (value) => value.close(), "Bubble private Vite server creation");
			await bubbleDeadline(server.listen(), 30000, "Bubble private server listen");
			if (closing) throw Error("Bubble session already closing");
			const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
			report.origin = origin;
			context = await owned(chromium.launchPersistentContext(join(artifacts, "profile"), {
				headless: true, executablePath, serviceWorkers: "block",
				env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp },
				args: ["--no-proxy-server", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--use-gl=angle", "--disable-webgpu"],
			}), (value) => value.close(), "Bubble private browser launch");
			await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true }));
			context.setDefaultTimeout(10000);
			await context.route("**/*", async (route) => {
				const url = new URL(route.request().url());
				if ((/^https?:$/.test(url.protocol) && url.origin === origin) || ["data:", "blob:"].includes(url.protocol)) await route.continue();
				else { report.externalRequests.push(url.origin); await route.abort(); }
			});
			page = await context.newPage();
			report.browserVersion = context.browser()?.version();
			loading = watchBubbleLoading(page, origin, report);
			console.log(JSON.stringify({ phase: "bubble-browser", diagnostic, artifacts, packageDirectory }));
			await Promise.race([loading.failed, (async () => {
				await page.goto(`${origin}/script/fixtures/bubble-browser-probe.html?backend=webgl&diagnostic=${Number(diagnostic)}`, { waitUntil: "commit", timeout: 30000 });
				await page.waitForFunction(() => Reflect.get(globalThis, "__bubbleResult") !== undefined, null, { timeout: 840000 });
			})()]);
		};
		await bubbleDeadline(work(), report.outerTimeoutMs, "Bubble session outer deadline");
	} catch (error) { report.failure = error.stack ?? String(error); }
	finally {
		closing = true;
		await captureBubble(page, artifacts, report, plan);
		loading?.stop();
		try {
			if (context) await bubbleDeadline(context.close(), 15000, "Bubble owned browser close");
			report.browserClosed = true;
		} catch (error) { report.browserCloseError = String(error); }
		try {
			if (server) await bubbleDeadline(server.close(), 15000, "Bubble owned server close");
			report.serverClosed = true;
		} catch (error) { report.serverCloseError = String(error); }
		if (frozen) report.postRunVerification = await verifyBubbleInputs(frozen);
		report.loadedInputs = Object.fromEntries(guard?.loaded ?? []);
		report.loadedVirtualInputs = Object.fromEntries(guard?.loadedVirtual ?? []);
		report.ok = !report.failure && report.checks?.ok === true && report.checks.backend === "webgl" &&
			report.checks.diagnostic === diagnostic && report.rawComplete === true &&
			!report.captureErrors.length && !report.pageErrors.length && !report.httpErrors.length && !report.requestFailures.length && !report.externalRequests.length &&
			!report.console.some((message) => message.type === "error") && report.browserClosed && report.serverClosed && report.postRunVerification?.ok === true;
		report.finishedAt = new Date().toISOString();
		await bubbleSaveJson(artifacts, "evidence.json", report);
		console.log(JSON.stringify({ phase: "bubble-session-finished", ok: report.ok, diagnostic, artifacts, failure: report.failure ?? report.checks?.failure ?? report.checks?.errors ?? report.captureErrors }));
	}
	return report;
}
