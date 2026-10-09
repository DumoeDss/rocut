import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { HYPERFRAMES_COMPILER_CHILD } from "../../apps/cli/src/programmatic/engines/hyperframes-compiler-child";
import { loadProgrammaticResource } from "../../apps/cli/src/programmatic/resources";
import { CURRENT_PROJECT_VERSION } from "../../packages/editor-classic/src/services/storage/migrations/version";
import { hyperframesModuleSources } from "./hyperframes-module-sources";
import { verifyHyperframesModules } from "./hyperframes-module-browser";
import {
	moduleCheck,
	moduleUncoveredBoundaries,
	type ModuleCheck,
} from "./hyperframes-module-verification";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
if (!toolchain || !isAbsolute(toolchain))
	throw Error("Expected private pinned toolchain");
const root = await mkdtemp(join(tmpdir(), "rocut-hf-modules-"));
const checks: ModuleCheck[] = [];
const check = (name: string, actual: unknown, expected: unknown) =>
	moduleCheck(checks, name, actual, expected);
const negative: { name: string; specifier: string; error: string }[] = [];
console.log(JSON.stringify({ artifact: root, step: "start" }));
// Syntax-check trusted fixed child text, never execute authored modules here.
new Function(HYPERFRAMES_COMPILER_CHILD);
const compilerEntry = pathToFileURL(
	join(toolchain, "node_modules/@hyperframes/core/dist/compiler/index.js"),
).href;
const { bundleToSingleHtml } = await import(compilerEntry);
const parserEntry = pathToFileURL(
	join(
		toolchain,
		"node_modules/@hyperframes/core/dist/compiler/htmlDocument.js",
	),
).href;
const { parseHTMLContent } = await import(parserEntry);
const sources: Record<string, string> = {
	...hyperframesModuleSources,
	"gsap.js": await readFile(
		join(toolchain, "node_modules/gsap/dist/gsap.min.js"),
		"utf8",
	),
};
async function stage(name: string, files: Record<string, string>) {
	const directory = join(root, name);
	for (const [id, code] of Object.entries(files)) {
		await mkdir(dirname(join(directory, id)), { recursive: true });
		await writeFile(join(directory, id), code, { flag: "wx" });
	}
	return directory;
}
const raw = await stage("upstream-original", sources);
const upstream = parseHTMLContent(
	await bundleToSingleHtml(raw, {
		entryFile: "index.html",
		runtime: "inline",
		inlineAssets: true,
	}),
);
const retained = [...upstream.querySelectorAll("script[src]")].map(
	(el: Element) => el.getAttribute("src"),
);
check(
	"upstream-preserves-external-module",
	retained.includes("main.mjs"),
	true,
);
check(
	"old-audit-rejects-native-module",
	retained.some(
		(src) => src !== null && !src.startsWith("data:") && !src.startsWith("#"),
	),
	true,
);
console.log(JSON.stringify({ step: "upstream-preserves-esm", retained }));
const context = {
	store: new FileProjectStore({
		root: join(root, "attachments"),
		schemaVersion: CURRENT_PROJECT_VERSION,
	}),
	projectId: "hf-module-acceptance",
};
const compile = (directory: string, files: string[]) =>
	compileProgrammaticProject({
		action: "compile",
		input: {
			version: 1,
			engine: "hyperframes",
			sourceDirectory: directory,
			entryFile: "index.html",
			files,
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
const directory = await stage("source", sources);
const compiled = await compile(directory, Object.keys(sources));
check(
	"no-authored-code-in-host",
	Reflect.has(globalThis, "__sharedCount"),
	false,
);
await rename(directory, join(root, "source-renamed"));
const rebuilt = await compileProgrammaticProject({
	action: "rebuild",
	input: JSON.parse(JSON.stringify(compiled.source)),
	toolchainDirectory: toolchain,
	context,
	signal: AbortSignal.timeout(60000),
	enqueue: (task) => task(),
});
check("archive-rebuild-reused", rebuilt.reusedDocument, true);
check(
	"archive-rebuild-sha256",
	rebuilt.source.resources[0].sha256,
	compiled.source.resources[0].sha256,
);
const { body } = await loadProgrammaticResource({
	...context,
	resource: rebuilt.source.resources[0],
});
const { body: lockBody } = await loadProgrammaticResource({
	...context,
	resource: rebuilt.source.build!.toolchainLock,
});
const archivedToolchain = JSON.parse(
	new TextDecoder("utf-8", { fatal: true }).decode(lockBody),
);
for (const [name, version] of [
	["@hyperframes/core", "0.8.139"],
	["acorn", "8.19.0"],
])
	check(
		`archived-${name}-pin`,
		archivedToolchain.packages.find(
			(item: { path: string }) => item.path === `node_modules/${name}`,
		)?.version,
		version,
	);
const code = new TextDecoder("utf-8", { fatal: true }).decode(body);
await writeFile(join(root, "compiled.html"), code, { flag: "wx" });
console.log(
	JSON.stringify({
		step: "compile-archive-rebuild",
		sha256: rebuilt.source.resources[0].sha256,
		bytes: body.byteLength,
	}),
);
for (const [name, specifier] of [
	["undeclared", "./missing.mjs"],
	["escape", "../../outside.mjs"],
	["network", "https://example.invalid/mod.mjs"],
	["node", "node:fs"],
]) {
	const rejected = {
		"index.html": sources["index.html"].replace(
			'src="main.mjs"',
			'src="bad.mjs"',
		),
		"bad.mjs": `import '${specifier}';`,
		"gsap.js": sources["gsap.js"],
		"scenes/nested.html": sources["scenes/nested.html"],
		"lib/shared.mjs": sources["lib/shared.mjs"],
		"scenes/helper.mjs": sources["scenes/helper.mjs"],
		"scenes/local.mjs": sources["scenes/local.mjs"],
	};
	let error = "";
	try {
		await compile(await stage(name, rejected), Object.keys(rejected));
	} catch (failure) {
		error = String(failure);
	}
	negative.push({ name, specifier, error });
	check(
		`negative-${name}`,
		/undeclared|escapes|Network|scheme/.test(error),
		true,
	);
}
console.log(JSON.stringify({ step: "negative-compile", cases: 4 }));
const browser = await verifyHyperframesModules(code);
const report = {
	schemaVersion: 1,
	artifact: root,
	checks,
	negative,
	compile: compiled.source,
	rebuild: rebuilt.source,
	archivedToolchain,
	upstreamRetained: retained,
	browser,
	uncovered: moduleUncoveredBoundaries,
};
await writeFile(
	join(root, "verification.json"),
	JSON.stringify(report, null, 2),
	{ flag: "wx" },
);
console.log(JSON.stringify({ step: "passed", artifact: root }));
