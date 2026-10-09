import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HYPERFRAMES_MODULE_RESOLVER_SOURCE } from "../programmatic/engines/hyperframes-module-resolver";
import { HYPERFRAMES_MODULE_PARSER_SOURCE } from "../programmatic/engines/hyperframes-module-parser";

// This evaluates the fixed adapter, never the authored module fixtures. Acorn
// parses both original and rewritten code without invoking any author code.
const adapter = new Function(
	HYPERFRAMES_MODULE_RESOLVER_SOURCE +
		HYPERFRAMES_MODULE_PARSER_SOURCE +
		"return {url:hfModuleUrl,address:hfModuleAddress,file:hfModuleFile,maps:hfModuleImportMaps,resolve:hfModuleResolve,rewrite:hfModuleRewrite};",
)();

test("module addresses retain the original importer directory and remain inside the archive", () => {
	const base = adapter.url("scenes/deep/main.mjs");
	expect(adapter.file(adapter.address("../shared.mjs", base))).toBe(
		"scenes/shared.mjs",
	);
	expect(adapter.file(adapter.address("/root.mjs", base))).toBe("root.mjs");
	expect(
		adapter.file(adapter.address("./encoded%20name.mjs?variant=1#part", base)),
	).toBe("scenes/deep/encoded name.mjs");
	for (const value of [
		"../../../escape.mjs",
		"//evil.test/a.mjs",
		"https://evil.test/a.mjs",
		"node:fs",
		"data:text/javascript,export{}",
		"C:\\outside.mjs",
		"./%2fescape.mjs",
	])
		expect(() => adapter.file(adapter.address(value, base))).toThrow();
});

test("import-map exact/prefix/scoped resolution preserves blocked entries and rejects escapes", () => {
	const base = adapter.url("index.html");
	const maps = adapter.maps(
		[
			{
				imports: { dep: "./global.mjs", "pkg/": "./lib/", blocked: null },
				scopes: { "./scenes/": { dep: "./scene.mjs" } },
			},
		],
		base,
	);
	expect(
		adapter.file(adapter.resolve("dep", adapter.url("entry.mjs"), maps)),
	).toBe("global.mjs");
	expect(
		adapter.file(adapter.resolve("dep", adapter.url("scenes/entry.mjs"), maps)),
	).toBe("scene.mjs");
	expect(adapter.file(adapter.resolve("pkg/sub.mjs", base, maps))).toBe(
		"lib/sub.mjs",
	);
	for (const specifier of [
		"unknown",
		"blocked",
		"pkg/../escape.mjs",
		"https://example.test/module.mjs",
		Symbol("module"),
	])
		expect(() => adapter.resolve(specifier, base, maps)).toThrow();
	expect(() =>
		adapter.maps(
			[{ imports: { bad: "https://example.test/module.mjs" } }],
			base,
		),
	).toThrow();
});

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
async function parser() {
	const directory = join(toolchain!, "node_modules/acorn");
	const manifest = JSON.parse(
		await readFile(join(directory, "package.json"), "utf8"),
	);
	expect(manifest.version).toBe("8.19.0");
	return import(pathToFileURL(join(directory, "dist/acorn.mjs")).href);
}

test.skipIf(!toolchain)(
	"pinned parser handles exports, escaped imports, TLA and literal dynamic imports without executing modules",
	async () => {
		const acorn = await parser(),
			calls: string[] = [];
		const source = [
			'// import "./comment-only.mjs"',
			'const text = "import(\\"./string-only.mjs\\")";',
			'const expression = /import\\("not a module"\\)/;',
			'import {x} from "\\u002e/real.mjs";',
			'export * from "./re-export.mjs";',
			'export {value} from "./named.mjs";',
			'const lazy = await import("./lazy.mjs");',
			"globalThis.compilerMustNeverExecuteThis = true;",
		].join("\n");
		const result = adapter.rewrite(
			source,
			adapter.url("scene/main.mjs"),
			acorn,
			(name: string) => {
				calls.push(name);
				return "https://rocut.invalid/known/" + name;
			},
			"rocut:runtime",
		);
		expect(calls).toEqual([
			"./real.mjs",
			"./re-export.mjs",
			"./named.mjs",
			"./lazy.mjs",
		]);
		expect(result.dynamic).toBe(false);
		expect(result.code).toContain('// import "./comment-only.mjs"');
		expect(result.code).toContain(
			"globalThis.compilerMustNeverExecuteThis = true;",
		);
		expect(Reflect.has(globalThis, "compilerMustNeverExecuteThis")).toBe(false);
		expect(() =>
			acorn.parse(result.code, { ecmaVersion: "latest", sourceType: "module" }),
		).not.toThrow();
	},
);

test.skipIf(!toolchain)(
	"computed imports and import.meta keep syntax, unique bindings and original base",
	async () => {
		const acorn = await parser();
		const source =
			"#!/usr/bin/env node\nconst __rocutModule=1,__rocutModuleMeta=2;\nconst value=await import((await import(name)).default + import.meta.url);\nexport const identity=import.meta===import.meta;";
		const base = adapter.url("scene/main.mjs");
		const result = adapter.rewrite(
			source,
			base,
			acorn,
			() => {
				throw Error("Unexpected literal import");
			},
			"rocut:runtime",
		);
		expect(result.dynamic).toBe(true);
		expect(
			result.code.startsWith("#!/usr/bin/env node\nimport * as __rocutModule_"),
		).toBe(true);
		expect(result.code).toContain("__rocutModule_Meta===__rocutModule_Meta");
		expect(result.code).toContain(".loadUrl(");
		expect(() =>
			acorn.parse(result.code, { ecmaVersion: "latest", sourceType: "module" }),
		).not.toThrow();
		const inline = adapter.rewrite(
			"await import(name); export const url=import.meta.url;",
			base,
			acorn,
			() => "unused",
			"rocut:runtime",
			true,
		);
		expect(inline.code).toContain(JSON.stringify(base));
		expect(() =>
			acorn.parse(inline.code, { ecmaVersion: "latest", sourceType: "module" }),
		).not.toThrow();
		const metadataOnly = adapter.rewrite(
			"export const resolve=import.meta.resolve;",
			base,
			acorn,
			() => "unused",
			"rocut:runtime",
		);
		expect(metadataOnly.dynamic).toBe(true);
	},
);
