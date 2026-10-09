import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import {
	loadProgrammaticResource,
	resourceDigest,
} from "../../apps/cli/src/programmatic/resources";
import { CURRENT_PROJECT_VERSION } from "../../packages/editor-classic/src/services/storage/migrations/version";
import { hyperframesResourceSources } from "./hyperframes-resource-sources";
import { verifyHyperframesResources } from "./hyperframes-resource-browser";
import { verifyHyperframesModules } from "./hyperframes-module-browser";
import {
	moduleCheck,
	type ModuleCheck,
} from "./hyperframes-module-verification";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
if (!toolchain || !isAbsolute(toolchain))
	throw Error("Expected private pinned toolchain");
const root = await mkdtemp(join(tmpdir(), "rocut-hf-resources-"));
console.log(JSON.stringify({ step: "start", artifact: root }));
const checks: ModuleCheck[] = [];
const check = (name: string, actual: unknown, expected: unknown) =>
	moduleCheck(checks, name, actual, expected);
const sources = {
	...(await hyperframesResourceSources()),
	"gsap.js": await readFile(
		join(toolchain, "node_modules/gsap/dist/gsap.min.js"),
		"utf8",
	),
};
async function stage(name: string, files: Record<string, string | Uint8Array>) {
	const directory = join(root, name);
	for (const [id, bytes] of Object.entries(files)) {
		await mkdir(dirname(join(directory, id)), { recursive: true });
		await writeFile(join(directory, id), bytes, { flag: "wx" });
	}
	return directory;
}
const context = {
	store: new FileProjectStore({
		root: join(root, "attachments"),
		schemaVersion: CURRENT_PROJECT_VERSION,
	}),
	projectId: "hf-resource-acceptance",
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
for (const [id, bytes] of Object.entries(sources)) {
	const resource = compiled.source.build!.inputs.find(
		(item) => item.id === id,
	)!;
	const archived = await loadProgrammaticResource({ ...context, resource });
	const original =
		typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
	check(
		`archive-original-${id}`,
		resourceDigest(archived.body),
		resourceDigest(Uint8Array.from(original).buffer),
	);
}
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
const code = new TextDecoder("utf-8", { fatal: true }).decode(body);
await writeFile(join(root, "compiled.html"), code, { flag: "wx" });
const negative = [];
for (const [name, specifier] of [
	["undeclared", "./missing.png"],
	["escape", "../../outside.png"],
	["network", "https://example.invalid/image.png"],
]) {
	const rejected = {
		...sources,
		"main.mjs": `new URL(${JSON.stringify(specifier)},import.meta.url);`,
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
const browser = await verifyHyperframesResources(code);
// The resource fixture extends the full module fixture. Recheck its executable
// graph as well: accepting asset URLs must not broaden import() admission or
// change native singleton/cycle/metadata semantics.
const modules = await verifyHyperframesModules(code);
const report = {
	schemaVersion: 1,
	artifact: root,
	compile: compiled.source,
	rebuild: rebuilt.source,
	checks,
	negative,
	browser,
	modules,
	uncovered: [
		"Only direct unshadowed new URL(input, import.meta.url) is adapted; aliased meta.url/URL and globalThis.URL forms remain unsupported.",
		"No global URL override or native hierarchical resource route is installed.",
		"Query-specific import-map scope handling and classic-script imports remain outside this resource-stage verification.",
	],
};
await writeFile(
	join(root, "verification.json"),
	JSON.stringify(report, null, 2),
	{ flag: "wx" },
);
console.log(
	JSON.stringify({
		step: "passed",
		artifact: root,
		checks: checks.length,
		browserChecks: browser.checks.length,
		moduleChecks: modules.checks.length,
		sha256: rebuilt.source.resources[0].sha256,
		requests: browser.requests.length,
	}),
);
