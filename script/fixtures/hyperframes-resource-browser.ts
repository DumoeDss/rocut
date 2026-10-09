import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { htmlCaptureExpression } from "../../apps/cli/src/programmatic/html-document";
import {
	moduleCheck,
	type ModuleCheck,
} from "./hyperframes-module-verification";

export async function verifyHyperframesResources(code: string) {
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
			errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.route("**/*", (route) => {
			requests.push(route.request().url());
			return route.abort();
		});
		await page.goto("about:blank");
		await page.evaluate(
			htmlCaptureExpression(code, {
				time: 0,
				frame: 0,
				frameRate: { numerator: 25, denominator: 1 },
				seed: 11,
				width: 64,
				height: 64,
			}),
		);
		const inner = page.frames().find((frame) => frame !== page.mainFrame());
		assert(inner);
		await inner.waitForFunction(
			() =>
				Reflect.has(globalThis, "__resourceResult") &&
				Reflect.has(globalThis, "__resourceAliasResult") &&
				Reflect.has(globalThis, "__rootResource") &&
				Reflect.has(globalThis, "__nestedResource"),
			undefined,
			{ timeout: 10000 },
		);
		const result = await inner.evaluate(() => ({
			...Reflect.get(globalThis, "__resourceResult"),
			aliases: Reflect.get(globalThis, "__resourceAliasResult"),
			root: Reflect.get(globalThis, "__rootResource"),
			nested: Reflect.get(globalThis, "__nestedResource"),
		}));
		for (const field of ["computed", "fromResolved", "root", "nested"])
			check(`same-resource-${field}`, result[field], result.picture);
		check("real-image-decode", [result.width, result.height], [1, 1]);
		check(
			"real-font-load",
			[result.fontStatus, result.fontFamily],
			["loaded", "ModuleArchivedFont"],
		);
		check("real-audio-metadata", result.mediaDuration, 0.1);
		check("audio-mime", result.mediaType, "data:audio/wav");
		check("base-evaluated-once", result.directBaseReads, 1);
		check("argument-order", result.order, ["input"]);
		check(
			"shadowed-URL-not-rewritten",
			result.scopedInput,
			"./intentionally-undeclared-local-constructor.png",
		);
		for (const field of ["nativeURL", "nativeInstance", "nativeStatic"])
			check(field, result[field], true);
		check("resource-closed-graph", result.denied, [true, true, true]);
		check("resources-never-imported-as-modules", result.resourcesAsModules, [
			true,
			true,
			true,
		]);
		check("resource-code-never-executed", result.resourceExecuted, false);
		check(
			"alias-custom-callee-read-once-before-arguments",
			result.aliases.customOrder,
			["callee", "input", "construct", "callee", "construct"],
		);
		check(
			"alias-custom-original-two-arguments",
			result.aliases.customArguments,
			["./aliased-custom-undeclared.png", result.aliases.customBase],
		);
		check(
			"alias-non-constructor-keeps-argument-effects",
			result.aliases.nonConstructorEffects,
			1,
		);
		for (const field of ["picture", "extracted", "global", "ordered"])
			check(`alias-resource-${field}`, result.aliases[field], result.picture);
		check(
			"alias-real-image-decode",
			[result.aliases.width, result.aliases.height],
			[1, 1],
		);
		check("alias-real-font-load", result.aliases.fontStatus, "loaded");
		check(
			"alias-native-constructor-and-prototype",
			result.aliases.native,
			true,
		);
		check("alias-native-static-functions", result.aliases.nativeStatic, true);
		check("alias-evaluation-and-conversion-order", result.aliases.order, [
			"input-expression",
			"base-expression",
			"convert-input",
		]);
		check("alias-closed-resource-graph", result.aliases.denied, [
			true,
			true,
			true,
		]);
		check("alias-resource-module-separation", result.aliases.moduleDenied, [
			true,
			true,
		]);
		check(
			"alias-shadowed-constructor",
			result.aliases.localInput,
			"./local-only.png",
		);
		check(
			"alias-shadowed-global-object",
			result.aliases.globalLocalInput,
			"./global-local-only.png",
		);
		check("page-errors", errors, []);
		check("external-requests", requests, []);
		const csp = await inner.evaluate(() =>
			document
				.querySelector('meta[http-equiv="Content-Security-Policy"]')
				?.getAttribute("content"),
		);
		return {
			checks,
			result,
			csp,
			browser: browser.version(),
			requests,
			errors,
		};
	} finally {
		await browser.close();
	}
}
