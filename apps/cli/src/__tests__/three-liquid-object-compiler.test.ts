import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginBuild, Plugin, BuildOptions } from "esbuild";
import { THREE_LIQUID_OBJECT_COMPILER_MODULES } from "../programmatic/engines/three-liquid-object-compiler-plugin";

const esbuild = await import(
	pathToFileURL(createRequire(import.meta.url).resolve("esbuild")).href
);
const install: (
	api: PluginBuild,
	options: { driver: string; runtime: string; project: string },
) => void = new Function(
	`${THREE_LIQUID_OBJECT_COMPILER_MODULES};return installLiquidObjectCompilerModules;`,
)();

async function fixture(files: Record<string, string>) {
	const root = await mkdtemp(join("C:/tmps", "liquid-object-compiler-"));
	for (const [name, source] of Object.entries(files)) {
		await mkdir(join(root, name, ".."), { recursive: true });
		await writeFile(join(root, name), source, { encoding: "utf8", flag: "wx" });
	}
	return root;
}

function compile({
	project,
	driver,
	runtime = "export const grant='HOST_ONLY';",
}: {
	project: string;
	driver: string;
	runtime?: string;
}) {
	const plugin: Plugin = {
		name: "liquid-private-modules",
		setup(api) {
			install(api, { driver, runtime, project });
			api.onResolve({ filter: /^rocut:entry$/ }, () => ({
				path: join(project, "entry.js"),
			}));
		},
	};
	const options: BuildOptions = {
		entryPoints: ["rocut:liquid-driver"],
		plugins: [plugin],
		bundle: true,
		write: false,
		platform: "browser",
		format: "iife",
		logLevel: "silent",
	};
	return esbuild.build(options);
}

test("actual esbuild grants runtime only to the generated driver namespace", async () => {
	const root = await fixture({ "entry.js": "export const authored='scene';" });
	const built = await compile({
		project: root,
		driver:
			"import {grant} from 'rocut:liquid-runtime'; import {authored} from 'rocut:entry'; window.result=grant+authored;",
	});
	expect(built.outputFiles[0].text).toContain("HOST_ONLY");
	expect(built.outputFiles[0].text).toContain("scene");
});

test("author imports, re-exports and dynamic imports cannot claim the runtime", async () => {
	for (const source of [
		"import {grant} from 'rocut:liquid-runtime'; window.grant=grant;",
		"export {grant} from 'rocut:liquid-runtime';",
		"window.grant=import('rocut:liquid-runtime');",
		"window.grant=require('rocut:liquid-runtime');",
		"import 'rocut:liquid-driver';",
	]) {
		const root = await fixture({ "entry.js": source });
		await expect(
			compile({ project: root, driver: "import 'rocut:entry';" }),
		).rejects.toThrow(/private compiler entry|generated driver/);
	}
});

test("an authored file with the driver basename or a nested module has no private namespace", async () => {
	for (const file of ["rocut-liquid-driver.js", "nested/driver.js"]) {
		const root = await fixture({
			"entry.js": `import './${file}';`,
			[file]: "import {grant} from 'rocut:liquid-runtime'; window.grant=grant;",
		});
		await expect(
			compile({ project: root, driver: "import 'rocut:entry';" }),
		).rejects.toThrow("generated driver");
	}
});

test("a driver dynamic import and runtime self-claim fail closed", async () => {
	const root = await fixture({ "entry.js": "window.scene=true;" });
	await expect(
		compile({
			project: root,
			driver: "window.grant=import('rocut:liquid-runtime');",
		}),
	).rejects.toThrow("generated driver");
	await expect(
		compile({
			project: root,
			driver: "import {grant} from 'rocut:liquid-runtime'; window.grant=grant;",
			runtime:
				"import {grant as other} from 'rocut:liquid-runtime'; export const grant=other;",
		}),
	).rejects.toThrow("generated driver");
});
