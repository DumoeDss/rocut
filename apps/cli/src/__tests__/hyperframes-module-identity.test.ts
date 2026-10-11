import { expect, test } from "bun:test";
import { HYPERFRAMES_MODULE_RESOLVER_SOURCE } from "../programmatic/engines/hyperframes-module-resolver";
import { HYPERFRAMES_MODULE_RUNTIME_SOURCE } from "../programmatic/engines/hyperframes-module-runtime";
import { HYPERFRAMES_MODULE_GRAPH_SOURCE } from "../programmatic/engines/hyperframes-module-graph";
import { join, resolve } from "node:path";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { runCompilerChild } from "../programmatic/engines/compiler-process";

// Evaluate the fixed adapter only, not authored module source.
const adapter = new Function(
	HYPERFRAMES_MODULE_RESOLVER_SOURCE + HYPERFRAMES_MODULE_RUNTIME_SOURCE +
	"return {url:hfModuleUrl,file:hfModuleFile,maps:hfModuleImportMaps,resolve:hfModuleResolve,create:hfCreateModuleRuntime};",
)();
const entry = adapter.url("index.html");
const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const plain = adapter.url("scenes/main.mjs");
const variant = plain + "?variant=one#scene";
const maps = adapter.maps([{ imports: { dep: "./global.mjs" }, scopes: {
	"./scenes/main.mjs?variant=two": { dep: "./query.mjs?selected=one#dep" },
	"./scenes/main.mjs?variant=one#scene": { dep: "./fragment.mjs" },
} }], entry);

test("query-specific exact scopes match full referrers without collapsing physical files", () => {
	expect(adapter.resolve("dep", plain, maps)).toBe(adapter.url("global.mjs"));
	expect(adapter.resolve("dep", plain + "?variant=two", maps)).toBe(adapter.url("query.mjs") + "?selected=one#dep");
	expect(adapter.resolve("dep", variant, maps)).toBe(adapter.url("fragment.mjs"));
	expect(adapter.resolve("./child.mjs", variant, maps)).toBe(adapter.url("scenes/child.mjs"));
	expect(adapter.file(variant)).toBe("scenes/main.mjs");
});

test.skipIf(!toolchain)("fixed isolated compiler archives distinct query bodies without executing author code", async () => {
	const project = await mkdtemp("C:/tmps/hf-url-compile-");
	const files = ["index.html", "main.mjs", "a.mjs", "b.mjs"];
	await writeFile(join(project, "index.html"), '<html><head><script type="importmap">' + JSON.stringify({
		imports: { dep: "./a.mjs" }, scopes: { "./main.mjs?two": { dep: "./b.mjs" } },
	}) + '</script></head><body><div data-composition-id="root" data-start="0" data-duration="1" data-width="64" data-height="64"></div>' +
		'<script type="module">import "./main.mjs?one"; import "./main.mjs?two";</script></body></html>', "utf8");
	await writeFile(join(project, "main.mjs"), "import {value} from 'dep'; export const origin=import.meta.url; export const result=value; throw Error('author-must-not-run-in-compiler');", "utf8");
	await writeFile(join(project, "a.mjs"), "export const value='a';", "utf8");
	await writeFile(join(project, "b.mjs"), "export const value='b';", "utf8");
	const core = join(toolchain!, "node_modules/@hyperframes/core/dist");
	const outputFile = join(project, "compiled.html");
	await runCompilerChild({ project, files, entryFile: "index.html", outputFile,
		compilerEntry: pathToFileURL(join(core, "compiler/index.js")).href,
		parserEntry: pathToFileURL(join(core, "compiler/htmlDocument.js")).href,
		width: 64, height: 64, durationFrames: 30, seed: 7,
		frameRate: { numerator: 30, denominator: 1 }, driver: "", nativeAudio: false,
	}, AbortSignal.timeout(20000));
	const { parseHTMLContent } = await import(pathToFileURL(join(core, "compiler/htmlDocument.js")).href);
	const doc = parseHTMLContent(await readFile(outputFile, "utf8"));
	const imports = JSON.parse(doc.querySelector('script[type="importmap"]').textContent).imports;
	const decode = (uri: string) => Buffer.from(uri.split(",")[1].split("#")[0], "base64").toString("utf8");
	expect(decode(imports[adapter.url("main.mjs") + "?one"])).toContain(JSON.stringify(adapter.url("a.mjs")));
	expect(decode(imports[adapter.url("main.mjs") + "?two"])).toContain(JSON.stringify(adapter.url("b.mjs")));
	expect(await readFile(join(project, "main.mjs"), "utf8")).toContain("author-must-not-run-in-compiler");
});

test("runtime uses compiled full URL records without physical fallback or forged identities", () => {
	const uri = "data:text/javascript;base64,ZXhwb3J0e307";
	const bodies = Object.fromEntries([plain, variant, adapter.url("global.mjs"), adapter.url("fragment.mjs")].map(url => [url, uri]));
	const runtime = adapter.create(maps, bodies, {});
	const a = runtime.loadUrl("./main.mjs", plain);
	const b = runtime.loadUrl("./main.mjs?variant=one#scene", plain);
	expect(a).not.toBe(b);
	expect(runtime.loadUrl("./main.mjs?variant=one#scene", plain)).toBe(b);
	expect(runtime.metaUrl(b)).toBe(variant);
	expect(runtime.loadUrl(b, plain)).toBe(b);
	expect(runtime.resolveUrl("dep", runtime.metaUrl(b))).toBe(uri + "#rocut=" + encodeURIComponent(adapter.url("fragment.mjs")));
	for (const value of ["./main.mjs?variant=unknown", "./main.mjs#uncompiled", b.replace("#rocut=", "#rocut=forged")])
		expect(() => runtime.loadUrl(value, plain)).toThrow();
});

test("computed unseen query/hash identities use their finite scope class and enforce the runtime budget", () => {
	const defaultUri = "data:text/javascript;base64,ZXhwb3J0e307";
	const scopedUri = "data:text/javascript;base64,ZXhwb3J0IGNvbnN0IHg9MTs=";
	const localMaps = adapter.maps([{ scopes: { "./scenes/main.mjs": { dep: "./global.mjs" } } }], entry);
	const signature = JSON.stringify([plain]);
	const runtime = adapter.create(localMaps, {}, {}, { "scenes/main.mjs": { "[]": defaultUri, [signature]: scopedUri } });
	expect(runtime.loadUrl("./main.mjs", plain)).toBe(scopedUri + "#rocut=" + encodeURIComponent(plain));
	const neverObserved = plain + "?fresh=9384#unseen";
	const uri = runtime.loadUrl("./main.mjs?fresh=9384#unseen", plain);
	expect(uri).toBe(defaultUri + "#rocut=" + encodeURIComponent(neverObserved));
	expect(runtime.metaUrl(uri)).toBe(neverObserved);
	expect(runtime.loadUrl(uri, plain)).toBe(uri);
	expect(runtime.loadUrl(adapter.url("scenes/ignored/../main.mjs") + "?fresh=9384#unseen", plain)).toBe(uri);
	expect(runtime.loadUrl("./main.mjs?fresh=9384#other", plain)).not.toBe(uri);
	for (let index = 0; index < 1021; index++) runtime.loadUrl("./main.mjs?budget=" + index, plain);
	expect(() => runtime.loadUrl("./main.mjs?budget=overflow", plain)).toThrow("limit");
});

test.skipIf(!toolchain)("graph rewrites each full URL with its own scope and reads only physical declared bytes", async () => {
	const acorn = await import(pathToFileURL(join(toolchain!, "node_modules/acorn/dist/acorn.mjs")).href);
	const prepare = new Function(HYPERFRAMES_MODULE_GRAPH_SOURCE + "return prepareHyperframesModules;")();
	const project = resolve("C:/tmps/hf-url-identity-memory");
	const source = new Map([
		["index.html", "<html></html>"],
		["scenes/main.mjs", "import {value} from 'dep'; export const origin=import.meta.url; export {cycle} from './cycle.mjs?variant=one';"],
		["scenes/cycle.mjs", "export const cycle=1; export {origin} from './main.mjs?variant=one';"],
		["lazy.mjs", "export const lazy=1;"],
		["a.mjs", "export const value='a';"],
		["b.mjs", "export const value='b';"],
	]);
	const node = (type: string, code = "") => {
		const attrs = new Map([["type", type]]);
		return { textContent: code, getAttribute: (key: string) => attrs.get(key) ?? null,
			setAttribute: (key: string, value: string) => { attrs.set(key, value); },
			hasAttribute: (key: string) => attrs.has(key), removeAttribute: (key: string) => { attrs.delete(key); },
			remove: () => {} };
		// remove() is replaced below, so no author or DOM script executes.
	};
	const nodes: ReturnType<typeof node>[] = [];
	const makeNode = (type: string, code = "") => {
		const element = node(type, code);
		element.remove = () => { nodes.splice(nodes.indexOf(element), 1); };
		return element;
	};
	nodes.push(makeNode("importmap", JSON.stringify({ imports: { dep: "./a.mjs" }, scopes: {
		"./scenes/main.mjs?variant=one": { dep: "./a.mjs" },
		"./scenes/main.mjs?variant=two": { dep: "./b.mjs" },
	} })));
	nodes.push(makeNode("module", "import './scenes/main.mjs?variant=one'; import './scenes/main.mjs?variant=two'; const choice='./lazy.mjs?variant=one'; import(choice);"));
	const doc = { querySelectorAll: (selector: string) => selector === "template" ? []
		: selector === 'script[type="importmap"]' ? nodes.filter(element => element.getAttribute("type") === "importmap") : nodes,
		createElement: () => makeNode(""), head: { prepend: (element: ReturnType<typeof node>) => { nodes.unshift(element); } }, toString: () => "staged" };
	const reads: string[] = [];
	const fixed = await prepare({ project, files: [...source.keys()], entryFile: "index.html" },
		{ writeFile: async () => {} }, { readFileSync: (file: string) => {
			const id = path.relative(project, file).split(path.sep).join("/");
			expect(id).not.toContain("?"); expect(id).not.toContain("#"); return Buffer.from(source.get(id)!);
		} }, path, () => doc, (file: string) => reads.push(file), acorn);
	fixed.finalize(doc);
	const imports = JSON.parse(nodes.find(element => element.getAttribute("type") === "importmap").textContent).imports;
	const one = adapter.url("scenes/main.mjs") + "?variant=one", two = adapter.url("scenes/main.mjs") + "?variant=two";
	const decode = (uri: string) => Buffer.from(uri.split(",")[1].split("#")[0], "base64").toString("utf8");
	expect(decode(imports[one])).toContain(JSON.stringify(adapter.url("a.mjs")));
	expect(decode(imports[two])).toContain(JSON.stringify(adapter.url("b.mjs")));
	expect(imports[one]).not.toBe(imports[two]);
	expect(decode(imports[adapter.url("scenes/cycle.mjs") + "?variant=one"])).toContain(JSON.stringify(one));
	const bootstrap = nodes.find(element => element.getAttribute("data-rocut-hyperframes-module-graph") === "1")!;
	type Runtime = { loadUrl: (specifier: string, base: string) => string; metaUrl: (uri: string) => string };
	const context: { URL: typeof URL; __rocutHyperframesModuleGraph?: Runtime } = { URL };
	runInNewContext(bootstrap.textContent, context);
	const graph = context.__rocutHyperframesModuleGraph!;
	const lazy = graph.loadUrl("./lazy.mjs?never=observed#new", entry);
	expect(decode(lazy)).toContain("export const lazy=1");
	expect(graph.metaUrl(lazy)).toBe(adapter.url("lazy.mjs") + "?never=observed#new");
	const dynamicTwo = graph.loadUrl("./scenes/main.mjs?variant=two", entry);
	expect(dynamicTwo).toBe(imports[two]);
	expect(decode(graph.loadUrl("./scenes/main.mjs?fresh=unseen", entry))).toContain(JSON.stringify(adapter.url("a.mjs")));
	expect(new Set(reads).size).toBe(source.size);
});
