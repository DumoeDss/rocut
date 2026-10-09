import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { htmlCaptureExpression } from "../../apps/cli/src/programmatic/html-document";
import {
	moduleCheck,
	type ModuleCheck,
} from "./hyperframes-module-verification";

export async function verifyHyperframesModules(code: string) {
	const checks: ModuleCheck[] = [];
	const check = (name: string, actual: unknown, expected: unknown) =>
		moduleCheck(checks, name, actual, expected);
	const require = createRequire(
		new URL("../../apps/vite-example/package.json", import.meta.url),
	);
	const { chromium } = (await import(
		pathToFileURL(require.resolve("@playwright/test")).href
	)) as typeof import("@playwright/test");
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
		const requests: string[] = [],
			errors: string[] = [],
			messages: string[] = [];
		await page.route("**/*", (route) => {
			requests.push(route.request().url());
			return route.abort();
		});
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error")
				messages.push(message.text().slice(0, 500));
		});
		await page.addInitScript(() => {
			const violations: object[] = [];
			Reflect.set(globalThis, "__moduleViolations", violations);
			window.addEventListener("securitypolicyviolation", (event) =>
				violations.push({
					directive: event.effectiveDirective,
					blocked: event.blockedURI,
					sample: event.sample,
				}),
			);
		});
		await page.goto("about:blank");
		const frame = {
			time: 0,
			frame: 0,
			frameRate: { numerator: 25, denominator: 1 },
			seed: 11,
			width: 64,
			height: 64,
		};
		try {
			await page.evaluate(htmlCaptureExpression(code, frame));
		} catch (error) {
			const violations = await Promise.all(
				page
					.frames()
					.map((frame) =>
						frame.evaluate(() => Reflect.get(globalThis, "__moduleViolations")),
					),
			);
			console.log(
				JSON.stringify({
					step: "browser-diagnostic",
					errors,
					messages,
					requests,
					violations,
				}),
			);
			throw error;
		}
		const inner = page.frames().find((item) => item !== page.mainFrame());
		assert(inner, "Production opaque iframe exists");
		await inner.waitForFunction(
			() =>
				Reflect.has(globalThis, "__moduleResult") &&
				Reflect.has(globalThis, "__nestedModule") &&
				Reflect.has(globalThis, "__inlineShared"),
			undefined,
			{ timeout: 10000 },
		);
		const result = await inner.evaluate(() => {
			const root = Reflect.get(globalThis, "__moduleResult"),
				nested = Reflect.get(globalThis, "__nestedModule"),
				inline = Reflect.get(globalThis, "__inlineShared");
			return {
				...root,
				nestedValue: nested.value,
				nestedFlavor: nested.flavor,
				shared:
					root.singleton === nested.singleton && root.singleton === inline,
			};
		});
		check("module-executes-once", result.count, 1);
		check("shared-singleton", result.shared, true);
		check("cycle-live-binding", result.cycle, "cycle-ok");
		check("literal-import-tla", result.literal, "tla-ok");
		check("computed-import-tla", result.computed, "tla-ok");
		check("same-dynamic-module", result.sameLazy, true);
		check("reexport", result.reexported, "tla-ok");
		check("json-default", result.data, { value: "json-ok", changed: true });
		check("json-shared-singleton", result.jsonShared, true);
		check("json-mutation", result.jsonMutation, true);
		check("json-import-attributes-rejected", result.jsonAttributes, [
			true,
			true,
		]);
		check("import-map", result.flavor, "global");
		check("scoped-import-map", result.nestedFlavor, "scoped");
		check("nested-importer-origin", result.nestedValue, "nested-base-ok");
		check("computed-import-closed-graph", result.denied, [true, true, true]);
		check("meta-object-identity", result.metaSame, true);
		check(
			"meta-virtual-origin",
			result.metaUrl,
			"https://rocut.invalid/__rocut_modules__/main.mjs",
		);
		check(
			"meta-resolve-real-data-module",
			result.resolved.startsWith("data:text/javascript;base64,"),
			true,
		);
		check("meta-resolve-import-singleton", result.metaImport, true);
		check("meta-only-dependency", result.metaOnly, "meta-only-ok");
		check("meta-json-import-singleton", result.jsonMetaImport, true);
		check("meta-forged-data-rejected", result.metaDenied, [true, true]);
		check("meta-forged-data-never-executed", result.forgedExecuted, false);
		check("page-errors", errors, []);
		check("esm-external-requests", [...requests], []);
		const denied = await inner.evaluate(async () => {
			let network = false;
			try {
				await fetch("https://example.invalid/denied");
			} catch {
				network = true;
			}
			const worker = await new Promise<boolean>((resolve) => {
				let instance: Worker | undefined;
				const timer = setTimeout(() => {
					instance?.terminate();
					resolve(false);
				}, 2000);
				try {
					instance = new Worker("data:text/javascript,self.postMessage(1)");
					instance.onerror = () => {
						clearTimeout(timer);
						instance?.terminate();
						resolve(true);
					};
					instance.onmessage = () => {
						clearTimeout(timer);
						instance?.terminate();
						resolve(false);
					};
				} catch {
					clearTimeout(timer);
					resolve(true);
				}
			});
			const memoryData = await (
				await fetch('data:application/json,{"local":true}')
			).json();
			return { network, worker, memoryData };
		});
		check("csp-native-json-without-external-capability", denied, {
			network: true,
			worker: true,
			memoryData: { local: true },
		});
		check("all-external-requests", [...requests], []);
		const csp = await inner.evaluate(() =>
			document
				.querySelector('meta[http-equiv="Content-Security-Policy"]')
				?.getAttribute("content"),
		);
		const violations = await inner.evaluate(() =>
			Reflect.get(globalThis, "__moduleViolations"),
		);
		check(
			"csp-remote-connect-rejected",
			violations.some(
				(entry: { directive: string }) => entry.directive === "connect-src",
			),
			true,
		);
		check(
			"csp-worker-rejected",
			violations.some(
				(entry: { directive: string }) => entry.directive === "worker-src",
			),
			true,
		);
		const report = {
			browser: browser.version(),
			checks,
			result,
			denied,
			requests,
			csp,
			violations,
		};
		console.log(JSON.stringify({ step: "browser-native-esm", ...report }));
		return report;
	} finally {
		await browser.close();
	}
}

if (process.env.ROCUT_TEST_HF_MODULE_DOCUMENT)
	await verifyHyperframesModules(
		await readFile(process.env.ROCUT_TEST_HF_MODULE_DOCUMENT, "utf8"),
	);
