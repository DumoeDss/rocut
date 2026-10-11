import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HYPERFRAMES_CLASSIC_IMPORTS_SOURCE } from "../programmatic/engines/hyperframes-classic-imports";
import { HYPERFRAMES_MODULE_RESOLVER_SOURCE } from "../programmatic/engines/hyperframes-module-resolver";
import { HYPERFRAMES_CLASSIC_BOOTSTRAP_SOURCE } from "../programmatic/engines/hyperframes-classic-bootstrap";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import * as sync from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

// Execute the fixed compiler helper only. All authored fixture text is parsed,
// not evaluated, and there are no browser, package install or network operations.
const adapter = new Function(
	HYPERFRAMES_MODULE_RESOLVER_SOURCE +
		HYPERFRAMES_CLASSIC_IMPORTS_SOURCE +
		"return {rewrite:hfClassicRewrite,url:hfModuleUrl,maps:hfModuleImportMaps,resolve:hfModuleResolve};",
)();
const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
async function parser() {
	const directory = join(toolchain!, "node_modules/acorn");
	expect(
		JSON.parse(await readFile(join(directory, "package.json"), "utf8")).version,
	).toBe("8.19.0");
	return import(pathToFileURL(join(directory, "dist/acorn.mjs")).href);
}
const runtime = "globalThis.__rocutHyperframesModuleGraph";
test.skipIf(!toolchain)(
	"classic preparation preserves external attributes, distinct origins and unchanged script bytes",
	async () => {
		const acorn = await parser();
		const { parseHTMLContent } = await import(
			pathToFileURL(
				join(
					toolchain!,
					"node_modules/@hyperframes/core/dist/compiler/htmlDocument.js",
				),
			).href
		);
		const prepare = new Function(
			HYPERFRAMES_MODULE_RESOLVER_SOURCE +
				HYPERFRAMES_CLASSIC_BOOTSTRAP_SOURCE +
				"return prepareHyperframesClassicImports;",
		)();
		const root = await mkdtemp("C:/tmps/rocut-classic-preparation-");
		await mkdir(join(root, "scenes"));
		const external =
			'"use strict";const globalThis=null,window=null,Object=null;import(choice,{with:{type:"json"}});';
		const integrity =
			"sha256-" + createHash("sha256").update(external).digest("base64");
		await writeFile(join(root, "main.js"), external, "utf8");
		await writeFile(
			join(root, "plain.html"),
			'<html><body><script>"use strict";var untouched=1;</script></body></html>',
			"utf8",
		);
		const plain = await readFile(join(root, "plain.html"), "utf8");
		await writeFile(
			join(root, "index.html"),
			`<html><head><script src="main.js?external=yes#part" defer async integrity="${integrity}"></script></head><body><script>var __rocutHyperframesClassicGraph; import('./lazy.mjs');</script></body></html>`,
			"utf8",
		);
		await writeFile(
			join(root, "scenes/nested.html"),
			"<html><body><template><script>import('../lazy.mjs');</script></template></body></html>",
			"utf8",
		);
		const result = await prepare(
			{
				project: root,
				entryFile: "index.html",
				files: ["index.html", "plain.html", "scenes/nested.html", "main.js"],
			},
			fs,
			sync,
			path,
			parseHTMLContent,
			() => {},
			acorn,
		);
		expect(result.runtimeName).toBe("__rocutHyperframesClassicGraph_");
		expect(result.dynamic).toBe(true);
		expect(result.active).toBe(true);
		expect(result.literals.map((item: { base: string }) => item.base)).toEqual([
			adapter.url("index.html"),
			adapter.url("scenes/nested.html"),
		]);
		const doc = parseHTMLContent(
			await readFile(join(root, "index.html"), "utf8"),
		);
		const tag = doc.querySelector("script[src]");
		expect(tag.hasAttribute("defer")).toBe(true);
		expect(tag.hasAttribute("async")).toBe(true);
		expect(tag.hasAttribute("integrity")).toBe(false);
		const code = Buffer.from(
			tag.getAttribute("src").split(",")[1],
			"base64",
		).toString("utf8");
		expect(code).toContain(
			JSON.stringify(adapter.url("main.js") + "?external=yes#part"),
		);
		expect(code).toContain(result.runtimeName + ").loadUrl");
		expect(code.startsWith('"use strict";')).toBe(true);
		expect(await readFile(join(root, "main.js"), "utf8")).toBe(external);
		expect(await readFile(join(root, "plain.html"), "utf8")).toBe(plain);
	},
);
test.skipIf(!toolchain)(
	"classic scripts retain byte identity, strict directives and script-only admission",
	async () => {
		const acorn = await parser();
		for (const code of [
			'"use strict"; var shared=1; function classic(){return this;} // import("./not-code.mjs")',
			'#!/usr/bin/env node\nvar text="import(x)";',
		]) {
			expect(
				adapter.rewrite(
					code,
					adapter.url("index.html"),
					acorn,
					() => {
						throw Error("Unexpected resolver");
					},
					runtime,
				),
			).toEqual({ code, dynamic: false });
		}
		for (const code of [
			"import.meta.url",
			'import x from "./x.mjs"',
			"export const x=1",
			'await import("./x.mjs")',
		])
			expect(() =>
				adapter.rewrite(
					code,
					adapter.url("index.html"),
					acorn,
					() => "unused",
					runtime,
				),
			).toThrow();
	},
);

test.skipIf(!toolchain)(
	"literal imports use closed resolver, retain options, and reject unadmitted dependencies",
	async () => {
		const acorn = await parser(),
			base = adapter.url("scenes/page.html"),
			maps = adapter.maps([], base);
		const seen: string[] = [];
		const resolve = (value: string, origin: string) => {
			const url = adapter.resolve(value, origin, maps);
			if (url !== adapter.url("scenes/dep.mjs"))
				throw Error("Undeclared module");
			seen.push(url);
			return url;
		};
		const code =
			'"use strict"; var shared; import("./dep.mjs", {with: {type: "json"}});';
		const result = adapter.rewrite(code, base, acorn, resolve, runtime);
		expect(result.dynamic).toBe(false);
		expect(seen).toEqual([adapter.url("scenes/dep.mjs")]);
		expect(result.code).toBe(
			code.replace('"./dep.mjs"', JSON.stringify(seen[0])),
		);
		expect(
			acorn.parse(result.code, { ecmaVersion: "latest", sourceType: "script" })
				.body[0].directive,
		).toBe("use strict");
		for (const value of [
			"https://evil.test/x.mjs",
			"node:fs",
			"unknown",
			"./missing.mjs",
		])
			expect(() =>
				adapter.rewrite(
					`import(${JSON.stringify(value)})`,
					base,
					acorn,
					resolve,
					runtime,
				),
			).toThrow();
	},
);

test.skipIf(!toolchain)(
	"computed imports defer resolver into native coercion without changing options or evaluating fixture code",
	async () => {
		const acorn = await parser(),
			base = adapter.url("scenes/page.html");
		const code =
			'"use strict"; var __rocutClassicSpecifier; var promise=import((log.push("argument"), candidate()), (log.push("options"), {with:{type:"json"}}));';
		const result = adapter.rewrite(
			code,
			base,
			acorn,
			() => {
				throw Error("Computed must resolve only in browser");
			},
			runtime,
		);
		expect(result.dynamic).toBe(true);
		expect(
			result.code.startsWith('"use strict"; var __rocutClassicSpecifier;'),
		).toBe(true);
		const tree = acorn.parse(result.code, {
			ecmaVersion: "latest",
			sourceType: "script",
		});
		const call = tree.body[2].declarations[0].init;
		expect(call.type).toBe("ImportExpression");
		expect(result.code.slice(call.options.start, call.options.end)).toBe(
			'log.push("options"), {with:{type:"json"}}',
		);
		const carrier = call.source;
		expect(carrier.type).toBe("CallExpression");
		expect(carrier.arguments.length).toBe(1);
		expect(
			result.code.slice(carrier.arguments[0].start, carrier.arguments[0].end),
		).toBe('log.push("argument"), candidate()');
		expect(carrier.callee.type).toBe("ArrowFunctionExpression");
		expect(carrier.callee.params[0].name).toBe("__rocutClassicSpecifier_");
		const object = carrier.callee.body;
		expect(object.type).toBe("ObjectExpression");
		expect(object.properties[0].key.name).toBe("__proto__");
		expect(object.properties[0].value.value).toBeNull();
		expect(object.properties[1].key.name).toBe("toString");
		expect(object.properties[1].method).toBe(true);
		expect(
			object.properties[1].value.body.body[0].argument.callee.property.name,
		).toBe("loadUrl");
		expect(result.code.match(/candidate\(\)/g)).toHaveLength(1);
		expect(result.code).not.toContain("import *");
	},
);

test.skipIf(!toolchain)(
	"nested imports, generator expressions and lexical identifiers remain valid script AST",
	async () => {
		const acorn = await parser(),
			base = adapter.url("index.html");
		for (const code of [
			"var p=import(import(name));",
			"function* g(){return import(yield candidate);}",
			"async function f(){return import(await candidate);}",
			'var p=import(eval("name"));',
			"var p=import(this.name, options);",
		]) {
			const result = adapter.rewrite(
				code,
				base,
				acorn,
				() => {
					throw Error("Unexpected literal");
				},
				runtime,
			);
			expect(result.dynamic).toBe(true);
			expect(() =>
				acorn.parse(result.code, {
					ecmaVersion: "latest",
					sourceType: "script",
				}),
			).not.toThrow();
		}
	},
);
