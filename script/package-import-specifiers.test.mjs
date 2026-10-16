import assert from "node:assert/strict";
import { test } from "node:test";
import { moduleSpecifiers } from "./package-import-specifiers.mjs";

test("recognizes static, type, dynamic and CommonJS dependencies with their lines", () => {
	const references = moduleSpecifiers({
		path: "module.ts",
		text: [
			'import type { A } from "@elftia/types";',
			'import "@elftia/side-effect";',
			'export { A } from "@elftia/reexport";',
			'const a = import("@elftia/dynamic"); const b = require("@elftia/commonjs");',
			'import c = require("@elftia/import-equals");',
			'type D = import("@elftia/type-query").D;',
			"module.require(`@elftia/member-require`);",
		].join("\n"),
	});
	assert.deepEqual(references, [
		{ specifier: "@elftia/types", line: 1 },
		{ specifier: "@elftia/side-effect", line: 2 },
		{ specifier: "@elftia/reexport", line: 3 },
		{ specifier: "@elftia/dynamic", line: 4 },
		{ specifier: "@elftia/commonjs", line: 4 },
		{ specifier: "@elftia/import-equals", line: 5 },
		{ specifier: "@elftia/type-query", line: 6 },
		{ specifier: "@elftia/member-require", line: 7 },
	]);
});

test("ignores embedded scene source and prose while visiting template expressions", () => {
	const text = [
		"const driver = String.raw`",
		"import { loadModel } from '@elftia/three-assets';",
		"const lazy = import('@elftia/embedded');",
		"`;",
		`const replacement = "import { loadModel } from '@elftia/three-assets';";`,
		`// import { prose } from '@elftia/comment';`,
		'const interpolated = `scene ${await import("@elftia/actual-interpolation")}`;',
		'import { actual } from "@elftia/actual-module";',
	].join("\n");
	assert.deepEqual(moduleSpecifiers({ path: "scene.ts", text }), [
		{ specifier: "@elftia/actual-interpolation", line: 7 },
		{ specifier: "@elftia/actual-module", line: 8 },
	]);
});

test("handles multiline imports, JSX and escaped package names", () => {
	assert.deepEqual(
		moduleSpecifiers({
			path: "view.tsx",
			text: 'import {\n Component\n} from "@elftia/view";\nconst view = <Component />;\nimport "@\\u0065lftia/escaped";',
		}),
		[
			{ specifier: "@elftia/view", line: 3 },
			{ specifier: "@elftia/escaped", line: 5 },
		],
	);
});
