import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { htmlCaptureExpression } from "../../apps/cli/src/programmatic/html-document";
import { loadProgrammaticResource } from "../../apps/cli/src/programmatic/resources";
import { CURRENT_PROJECT_VERSION } from "../../packages/editor-classic/src/services/storage/migrations/version";
import { hyperframesClassicQuerySources } from "./hyperframes-classic-query-sources";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const browserPath = process.env.ROCUT_PROBE_BROWSER_PATH;
assert(toolchain && isAbsolute(toolchain), "Expected pinned toolchain path");
assert(
	browserPath && isAbsolute(browserPath),
	"Expected owned browser executable",
);
const directory = await mkdtemp(join("C:/tmps", "rocut-hf-classic-query-"));
console.log(JSON.stringify({ artifact: directory, step: "start" }));
const receipt: Record<string, unknown> = {
	status: "incomplete",
	toolchain,
	browserPath,
	boundaries: [
		"No encoded video",
		"No Electron or installed plugin",
		"Browser close awaited; process exit not independently observed",
	],
};
try {
	const source = join(directory, "source");
	const sources = {
		...hyperframesClassicQuerySources,
		"gsap.js": await readFile(
			join(toolchain, "node_modules/gsap/dist/gsap.min.js"),
			"utf8",
		),
	};
	for (const [id, body] of Object.entries(sources)) {
		await mkdir(dirname(join(source, id)), { recursive: true });
		await writeFile(join(source, id), body, { flag: "wx" });
	}
	const context = {
		store: new FileProjectStore({
			root: join(directory, "attachments"),
			schemaVersion: CURRENT_PROJECT_VERSION,
		}),
		projectId: "hyperframes-classic-query-smoke",
	};
	const compiled = await compileProgrammaticProject({
		action: "compile",
		input: {
			version: 1,
			engine: "hyperframes",
			sourceDirectory: source,
			entryFile: "index.html",
			files: Object.keys(sources),
			width: 64,
			height: 64,
			frameRate: { numerator: 25, denominator: 1 },
			durationFrames: 25,
			seed: 11,
		},
		toolchainDirectory: toolchain,
		context,
		signal: AbortSignal.timeout(60000),
		enqueue: (task) => task(),
	});
	const { body } = await loadProgrammaticResource({
		...context,
		resource: compiled.source.resources[0],
	});
	const html = new TextDecoder("utf-8", { fatal: true }).decode(body);
	await writeFile(join(directory, "compiled.html"), html, { flag: "wx" });
	receipt.document = {
		bytes: body.byteLength,
		sha256: compiled.source.resources[0].sha256,
	};
	const require = createRequire(
		new URL("../../apps/vite-example/package.json", import.meta.url),
	);
	const { chromium } = await import(
		pathToFileURL(require.resolve("@playwright/test")).href
	);
	const browser = await chromium.launch({
		headless: true,
		executablePath: browserPath,
	});
	try {
		receipt.browser = browser.version();
		const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
		const errors: string[] = [];
		const requests: string[] = [];
		page.on("pageerror", (error: Error) => errors.push(error.message));
		await page.route(
			"**/*",
			(route: { request(): { url(): string }; abort(): Promise<void> }) => {
				requests.push(route.request().url());
				return route.abort();
			},
		);
		await page.goto("about:blank");
		const nativeOrder = await page.evaluate(async () => {
			const order: string[] = [];
			function specifier() {
				order.push("specifier");
				return {
					toString() {
						order.push("coerce");
						return "data:text/javascript,export const value=1";
					},
				};
			}
			function options() {
				order.push("options");
				return {
					get with() {
						order.push("with");
						return {};
					},
				};
			}
			await import(specifier() as unknown as string, options());
			return order;
		});
		const nativeRejection = await page.evaluate(async () => {
			let synchronous = false;
			try {
				const promise = import({
					toString() {
						throw Error("conversion");
					},
				} as unknown as string);
				return await promise.then(
					() => ({ synchronous, message: "unexpected success" }),
					(error) => ({ synchronous, message: error.message }),
				);
			} catch (error) {
				synchronous = true;
				return { synchronous, message: (error as Error).message };
			}
		});
		receipt.nativeOrder = nativeOrder;
		receipt.nativeRejection = nativeRejection;
		await page.evaluate(
			htmlCaptureExpression(html, {
				time: 0,
				frame: 0,
				frameRate: { numerator: 25, denominator: 1 },
				seed: 11,
				width: 64,
				height: 64,
			}),
		);
		const inner = page
			.frames()
			.find((frame: { parentFrame(): unknown }) => frame.parentFrame());
		assert(inner, "Expected production opaque iframe");
		await inner.waitForFunction(
			() =>
				[
					"__classicInline",
					"__classicRejection",
					"__classicExternal",
					"__classicNested",
					"__queryResult",
				].every((key) => Reflect.has(globalThis, key)),
			undefined,
			{ timeout: 10000 },
		);
		const result = await inner.evaluate(() =>
			Object.fromEntries(
				[
					"__classicInline",
					"__classicRejection",
					"__classicExternal",
					"__classicNested",
					"__queryResult",
				].map((key) => [key, Reflect.get(globalThis, key)]),
			),
		);
		receipt.nativeOrder = nativeOrder;
		receipt.result = result;
		receipt.errors = errors;
		receipt.requests = requests;
		assert.deepEqual(
			result.__classicInline.order,
			nativeOrder,
			"Native options/coercion evaluation order",
		);
		assert.equal(result.__classicInline.value, "classic-ok");
		assert.deepEqual(result.__classicRejection, {
			synchronous: false,
			message: "conversion",
		});
		assert.deepEqual(
			result.__classicRejection,
			nativeRejection,
			"Native specifier failure is asynchronous rejection",
		);
		assert.equal(result.__classicExternal, "classic-ok");
		assert.equal(result.__classicNested, "classic-ok");
		assert.deepEqual(result.__queryResult, {
			same: true,
			different: true,
			url: "https://rocut.invalid/__rocut_modules__/logic.mjs?runtime=not-statically-seen#fresh",
			otherUrl:
				"https://rocut.invalid/__rocut_modules__/logic.mjs?runtime=not-statically-seen#other",
			scopedUrl:
				"https://rocut.invalid/__rocut_modules__/logic.mjs?scoped=blue#one",
			value: "global",
			scopedValue: "blue",
		});
		assert.deepEqual(errors, []);
		assert.deepEqual(requests, []);
		receipt.status = "complete";
	} finally {
		await browser.close();
		receipt.browserCloseAwaited = true;
	}
} catch (error) {
	receipt.error = String(error);
	throw error;
} finally {
	await writeFile(
		join(directory, "receipt.json"),
		JSON.stringify(receipt, null, 2),
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			artifact: directory,
			status: receipt.status,
			step: "finish",
		}),
	);
}
