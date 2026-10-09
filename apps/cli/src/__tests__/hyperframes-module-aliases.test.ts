import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HYPERFRAMES_MODULE_PARSER_SOURCE } from "../programmatic/engines/hyperframes-module-parser";

// Execute only the fixed adapter; author source is parsed, never evaluated here.
const rewrite = new Function(
	HYPERFRAMES_MODULE_PARSER_SOURCE + "return hfModuleRewrite;",
)();
const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const base = "https://rocut.invalid/__rocut_modules__/scenes/main.mjs";
const image = "'../assets/pixel.png'";
const construct = (ctor: string, origin = "import.meta.url") =>
	`new ${ctor}(${image},${origin})`;

const cases: [string, string[]][] = [
	[construct("globalThis.URL"), ["globalThis.URL"]],
	[construct("globalThis['URL']"), ["globalThis['URL']"]],
	[construct("URL", "import.meta['url']"), ["URL"]],
	[`const U=URL; const V=U; ${construct("V")}`, ["V"]],
	[`const root=globalThis; ${construct("root.URL")}`, ["root.URL"]],
	[`const {URL:U}=globalThis; ${construct("U")}`, ["U"]],
	[`const {['URL']:U}=globalThis; ${construct("U")}`, ["U"]],
	[`const {URL}=globalThis; ${construct("URL")}`, ["URL"]],
	[`const M=import.meta; ${construct("URL", "M.url")}`, ["URL"]],
	[`const M=import.meta; const {url:B}=M; ${construct("URL", "B")}`, ["URL"]],
	[`const B=import.meta.url; const C=B; ${construct("URL", "C")}`, ["URL"]],
	[`const U=URL; function f(URL){return ${construct("U")}}`, ["U"]],
	[`const U=URL; function f(U){return ${construct("U")}}`, []],
	[`function f(URL){const U=URL; return ${construct("U")}}`, []],
	[`function f(globalThis){return ${construct("globalThis.URL")}}`, []],
	[`const U=URL; {const U=class {}; ${construct("U")}}`, []],
	[`let U=URL; ${construct("U")}`, []],
	[`var U=URL; ${construct("U")}`, []],
	[`let B=import.meta.url; ${construct("URL", "B")}`, []],
	[`const [U]=[URL]; ${construct("U")}`, []],
	[`const {URL:U=URL}=globalThis; ${construct("U")}`, []],
	[`const {...root}=globalThis; ${construct("root.URL")}`, []],
	[`const key='URL'; const {[key]:U}=globalThis; ${construct("U")}`, []],
	[`const U=V; const V=U; ${construct("U")}`, []],
	[`const U=U; ${construct("U")}`, []],
	[`const U=URL; function f(value=${construct("U")}){var U;}`, ["U"]],
	[`const U=URL; function f(value=${construct("U")},U){}`, []],
	[`const U=URL; try {} catch(U) {${construct("U")}}`, []],
	[`const U=URL; for(const U of []) {${construct("U")}}`, []],
	[`import U from './local.mjs'; ${construct("U")}`, []],
	[
		`const U=URL; class C {static {var U;${construct("U")}} field=${construct("U")};}`,
		["U"],
	],
	[`const U=URL; new U(...[${image},import.meta.url]);`, []],
	[`const U=URL; new U(${image});`, []],
	[`const U=URL; new (U)((${image}), (import.meta.url),);`, ["U"]],
];

test.skipIf(!toolchain)(
	"immutable native URL/meta aliases retain constructors and obey lexical shadowing",
	async () => {
		const acorn = await import(
			pathToFileURL(join(toolchain!, "node_modules/acorn/dist/acorn.mjs")).href
		);
		for (const [source, expected] of cases) {
			const result = rewrite(
				source,
				base,
				acorn,
				() => "./local.mjs",
				"rocut:runtime",
			);
			const tree = acorn.parse(result.code, {
				ecmaVersion: "latest",
				sourceType: "module",
			});
			const constructors: string[] = [];
			const walk = (value: unknown) => {
				if (!value || typeof value !== "object") return;
				const node = value as {
					type?: string;
					callee?: {
						type?: string;
						callee?: { property?: { name?: string } };
						arguments?: { start: number; end: number }[];
					};
				};
				if (
					node.type === "NewExpression" &&
					node.callee?.type === "CallExpression" &&
					node.callee.callee?.property?.name === "resourceConstructor" &&
					node.callee.arguments?.[0]
				)
					constructors.push(
						result.code.slice(
							node.callee.arguments[0].start,
							node.callee.arguments[0].end,
						),
					);
				for (const child of Object.values(node)) walk(child);
			};
			walk(tree);
			expect(constructors, source).toEqual(expected);
		}
	},
);

test.skipIf(!toolchain)(
	"aliased constructors defer literal admission until actual native identity is known",
	async () => {
		const acorn = await import(
			pathToFileURL(join(toolchain!, "node_modules/acorn/dist/acorn.mjs")).href
		);
		const source = `const root=globalThis; const {URL:U}=root; const M=import.meta; const {url:B}=M; ${construct("U", "B")};`;
		const admitted: [string, string][] = [];
		const output = rewrite(
			source,
			base,
			acorn,
			() => "unused",
			"rocut:runtime",
			false,
			(value: string, origin: string) => admitted.push([value, origin]),
		);
		expect(admitted).toEqual([]);
		expect(output.resources).toBe(true);
	},
);
