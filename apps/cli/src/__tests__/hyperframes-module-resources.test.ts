import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HYPERFRAMES_MODULE_PARSER_SOURCE } from "../programmatic/engines/hyperframes-module-parser";
import { HYPERFRAMES_MODULE_RESOLVER_SOURCE } from "../programmatic/engines/hyperframes-module-resolver";
import { HYPERFRAMES_MODULE_RUNTIME_SOURCE } from "../programmatic/engines/hyperframes-module-runtime";
import { HYPERFRAMES_COMPILER_CHILD } from "../programmatic/engines/hyperframes-compiler-child";

// Only the fixed adapter is evaluated here. All authored fixture code goes to
// Acorn, never to eval/Function/import/require in the host process.
const adapter = new Function(
	HYPERFRAMES_MODULE_RESOLVER_SOURCE +
		HYPERFRAMES_MODULE_PARSER_SOURCE +
		HYPERFRAMES_MODULE_RUNTIME_SOURCE +
		"return {url:hfModuleUrl,rewrite:hfModuleRewrite,create:hfCreateModuleRuntime};",
)();
const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const sample = 'new URL("./picture.png", import.meta.url)';
const base = adapter.url("scene/main.mjs");
const maps = {
	imports: { picture: adapter.url("assets/picture.png") },
	scopes: {},
};
const bodies = {
	"scene/main.mjs": "data:text/javascript;base64,ZXhwb3J0e307",
	"data.json": "data:application/json;base64,e30=",
};
const assets = {
	"assets/picture.png": "data:image/png;base64,eHl6",
	"assets/icon.svg": "data:image/svg+xml;base64,PHN2Zy8+",
	"assets/font.woff2": "data:font/woff2;base64,eHl6",
	"assets/sound.wav": "data:audio/wav;base64,eHl6",
};
const runtime = adapter.create(maps, bodies, assets);

test("emitted fixed compiler remains valid JavaScript", () => {
	expect(() => new Function(HYPERFRAMES_COMPILER_CHILD)).not.toThrow();
});

test("closed resource resolver returns archived MIME bytes while import remains module-only", () => {
	for (const [id, uri] of Object.entries(assets)) {
		expect(runtime.resolveUrl("../" + id, base)).toBe(uri);
		expect(runtime.resourceArguments("../" + id, base)).toEqual([uri]);
		expect(() => runtime.loadUrl("../" + id, base)).toThrow("module");
		expect(() => runtime.loadUrl(uri, base)).toThrow("module");
	}
	expect(runtime.resolveUrl("picture", base)).toBe(
		assets["assets/picture.png"],
	);
	// URL path semantics intentionally do not apply bare import-map aliases.
	expect(() => runtime.resourceArguments("picture", base)).toThrow("resource");
	expect(runtime.resourceArguments("../assets/icon.svg#shape", base)).toEqual([
		assets["assets/icon.svg"] + "#shape",
	]);
	const module = runtime.resolveUrl("./main.mjs", base);
	expect(runtime.loadUrl(module, base)).toBe(module);
	expect(runtime.loadUrl(new URL(module), base)).toBe(module);
	expect(() =>
		runtime.loadUrl(module.replace("base64,", "base64,AAAA"), base),
	).toThrow();
	const json = runtime.resolveUrl("../data.json", base);
	expect(runtime.loadUrl(json, base)).toBe(json);
});

test("resource arguments preserve native URL identity, conversion order and local-only admission", () => {
	const original = URL,
		log: string[] = [];
	const args = runtime.resourceArguments(
		{
			[Symbol.toPrimitive]() {
				log.push("input");
				return "../assets/picture.png";
			},
		},
		{
			[Symbol.toPrimitive]() {
				log.push("base");
				return base;
			},
		},
	);
	const url = new URL(args[0]);
	expect(log).toEqual(["input", "base"]);
	expect(URL).toBe(original);
	expect(url.constructor).toBe(original);
	expect(Object.getPrototypeOf(url)).toBe(original.prototype);
	expect(url.href).toBe(assets["assets/picture.png"]);
	for (const specifier of [
		"../missing.png",
		"../../../escape.png",
		"//evil.test/x.png",
		"https://evil.test/x.png",
		"file:///secret",
		"data:image/png;base64,dW5kZWNsYXJlZA==",
		Symbol("asset"),
	])
		expect(() => runtime.resourceArguments(specifier, base)).toThrow();
	expect(() =>
		runtime.resourceArguments(
			"../assets/picture.png",
			"https://evil.test/main.mjs",
		),
	).toThrow("outside");
});

test.skipIf(!toolchain)(
	"Acorn URL rewrites honor lexical declarations, parameters, var hoisting and class scopes",
	async () => {
		const acorn = await import(
			pathToFileURL(join(toolchain!, "node_modules/acorn/dist/acorn.mjs")).href
		);
		const cases: [string, number][] = [
			[sample, 1],
			[`new (URL)((sideEffect(), './picture.png'), import.meta.url,)`, 1],
			[`new URL(${sample}.href, import.meta.url)`, 2],
			[`function f(URL){return ${sample}}`, 0],
			[`function f(value=${sample}, URL){}`, 0],
			[`function f(value=${sample}){var URL; return ${sample}}`, 1],
			[`{ ${sample}; let URL; } ${sample}`, 1],
			[`${sample}; {var URL;}`, 0],
			[`function f({constructor:URL}){return ${sample}}`, 0],
			[`function f(...URL){return ${sample}}`, 0],
			[`import URL from './other.mjs'; ${sample}`, 0],
			[`import {URL as Other} from './other.mjs'; ${sample}`, 1],
			[`class URL { field=${sample}; }`, 0],
			[`const C=class URL { field=${sample}; }; ${sample}`, 1],
			[`const f=function URL(){return ${sample}}; ${sample}`, 1],
			[`try {} catch (URL) {${sample}} ${sample}`, 1],
			[`for (let URL of [${sample}]) {${sample}} ${sample}`, 1],
			[`switch (${sample}) {case 1: ${sample}; let URL;}`, 1],
			[`class C {static {${sample};var URL;} field=${sample};}`, 1],
			[`function f(){${sample};{let URL;}}`, 1],
			[`const base=import.meta.url; new URL('./picture.png',base);`, 0],
			[
				`new globalThis.URL('./picture.png',import.meta.url); const U=URL; new U('./picture.png',import.meta.url);`,
				0,
			],
		];
		for (const [source, expected] of cases) {
			const output = adapter.rewrite(
				source,
				base,
				acorn,
				() => adapter.url("other.mjs"),
				"rocut:runtime",
				false,
				() => {},
			);
			const tree = acorn.parse(output.code, {
				ecmaVersion: "latest",
				sourceType: "module",
			});
			let wrappers = 0;
			const walk = (value: any) => {
				if (!value || typeof value !== "object") return;
				if (
					value.type === "NewExpression" &&
					value.arguments[0]?.type === "SpreadElement" &&
					value.arguments[0].argument.callee?.property?.name ===
						"resourceArguments"
				) {
					expect(value.callee).toMatchObject({
						type: "Identifier",
						name: "URL",
					});
					wrappers++;
				}
				for (const entry of Object.values(value))
					if (entry && typeof entry === "object") walk(entry);
			};
			walk(tree);
			expect(wrappers, source).toBe(expected);
		}
	},
);

test.skipIf(!toolchain)(
	"literal resource dependencies use the original importer and reject before browser execution",
	async () => {
		const acorn = await import(
			pathToFileURL(join(toolchain!, "node_modules/acorn/dist/acorn.mjs")).href
		);
		const calls: [string, string][] = [];
		const output = adapter.rewrite(
			`${sample}; new URL(name,import.meta.url);`,
			base,
			acorn,
			() => "unused",
			"rocut:runtime",
			false,
			(specifier: string, origin: string) => calls.push([specifier, origin]),
		);
		expect(calls).toEqual([["./picture.png", base]]);
		expect(output.resources).toBe(true);
		expect(() =>
			adapter.rewrite(
				sample,
				base,
				acorn,
				() => "unused",
				"rocut:runtime",
				false,
				() => {
					throw Error("undeclared resource");
				},
			),
		).toThrow("undeclared resource");
		expect(() =>
			acorn.parse(output.code, { ecmaVersion: "latest", sourceType: "module" }),
		).not.toThrow();
	},
);
