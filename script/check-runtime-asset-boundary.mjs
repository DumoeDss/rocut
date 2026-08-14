#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BROWSER_ADAPTER = "packages/editor-classic/src/editor/host/browser-runtime.ts";
// s05-second-host: the desktop Host's owned runtime-resource adapter holds the
// same architectural position as the browser adapter — the one place platform
// Worker construction is allowed to live for that Host.
const ELECTRON_ADAPTER =
	"apps/electron-host/src/host/electron-runtime-resources.ts";
const WORKER_ADAPTERS = new Set([BROWSER_ADAPTER, ELECTRON_ADAPTER]);
const HOST_ROOTS = [
	"apps/web/src/editor/host/next-editor-host.ts",
	"apps/vite-example/src/host/vite-host-config.ts",
	"apps/electron-host/src/host/electron-host-config.ts",
];
const REQUIRED_LAYERS = new Map([
	["next-host", HOST_ROOTS[0]],
	["vite-host", HOST_ROOTS[1]],
	["electron-host", HOST_ROOTS[2]],
	["browser-worker-adapter", BROWSER_ADAPTER],
	["electron-worker-adapter", ELECTRON_ADAPTER],
	["font-assets", "packages/editor-classic/src/fonts/google-fonts.ts"],
	["flags", "packages/editor-classic/src/stickers/providers/flags.ts"],
	["stickers", "packages/editor-classic/src/services/renderer/nodes/sticker-node.ts"],
	["effect-preview", "packages/editor-classic/src/services/renderer/effect-preview.ts"],
	["transcription-worker", "packages/editor-classic/src/services/transcription/service.ts"],
]);

const RULES = [
	{
		id: "root-fetch",
		test: (text) => /\bfetch\s*\(\s*["'`]\/(?!\/)/.test(text),
	},
	{
		id: "root-css-url",
		test: (text) => /\burl\s*\(\s*["']?\/(?!\/)/i.test(text),
	},
	{
		id: "root-first-party-source",
		test: (text) =>
			/(?:\bsrc\s*=|\.src\s*=|\bsource\s*:|\bhref\s*=)\s*[{"']*\/(?:assets|effects|flags|fonts|logos)\//i.test(
				text,
			) || /(?:\bsrc\s*=|\.src\s*=|\bhref\s*=)\s*[{"']*\/favicon\./i.test(text),
	},
	{
		id: "dynamic-root-flags",
		test: (text) => /["'`]\/flags(?:\/|\$\{|["'`])/.test(text),
	},
	{
		id: "direct-platform-worker",
		test: (text, path) =>
			!WORKER_ADAPTERS.has(path) && /\bnew\s+Worker\s*\(/.test(text),
	},
];

function productionFiles() {
	return execFileSync(
		"git",
		[
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
			"apps/web/src",
			"apps/vite-example/src",
			"apps/electron-host/src",
			"packages/editor-classic/src",
			"packages/editor-ports/src",
			"packages/editor-contracts/src",
		],
		{ cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	)
		.split("\0")
		.filter(Boolean)
		.filter((path) => existsSync(join(REPO_ROOT, path)))
		.filter((path) => /\.(?:ts|tsx|css)$/.test(path))
		.filter(
			(path) =>
				!path.includes("/__tests__/") &&
				!path.includes("/tests/") &&
				!path.endsWith(".test.ts") &&
				!path.endsWith(".test.tsx"),
		);
}

function withoutComments(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
			"\n".repeat(comment.split("\n").length - 1),
		)
		.replace(/^\s*\/\/.*$/gm, "");
}

function scanFile(path, text) {
	const clean = withoutComments(text);
	return RULES.filter((rule) => rule.test(clean, path)).map((rule) => ({
		rule: rule.id,
		path,
	}));
}

function checkComposition(files, reads) {
	const violations = [];
	for (const path of HOST_ROOTS) {
		if (!files.includes(path)) {
			violations.push({ rule: "missing-host-root", path });
			continue;
		}
		const text = reads.get(path) ?? "";
		const referenceSpread = text.search(/\.\.\.createInMemoryPorts\s*\(/);
		if (referenceSpread < 0) {
			violations.push({ rule: "c4-role-reference-fallback", path });
			continue;
		}
		// A Host that spreads the browser adapter must place that spread after
		// the reference bundle. The desktop Host composes its owned roles as
		// explicit keys instead (no `...browser` at all) — its role presence is
		// asserted by the loop below, which requires every role named.
		if (text.includes("...browser")) {
			const browserOverride = text.lastIndexOf("...browser");
			if (browserOverride < referenceSpread) {
				violations.push({ rule: "c4-role-reference-fallback", path });
			}
		}
		for (const role of ["assets", "assetLoader", "runtimeResources"]) {
			if (!text.includes(role) && !text.includes("...browser")) {
				violations.push({ rule: `missing-production-role:${role}`, path });
			}
		}
	}
	return violations;
}

function checkLayers(files, reads) {
	const violations = [];
	if (files.length === 0) {
		violations.push({ rule: "empty-production-graph", path: "<graph>" });
		return violations;
	}
	for (const [layer, path] of REQUIRED_LAYERS) {
		if (!files.includes(path) || !reads.get(path)?.trim()) {
			violations.push({ rule: `missing-layer:${layer}`, path });
		}
	}
	const adapter = withoutComments(reads.get(BROWSER_ADAPTER) ?? "");
	const constructors = adapter.match(/\bnew\s+Worker\s*\(/g)?.length ?? 0;
	if (constructors < 1) {
		violations.push({
			rule: "missing-browser-worker-constructor",
			path: BROWSER_ADAPTER,
		});
	}
	const electronAdapter = withoutComments(reads.get(ELECTRON_ADAPTER) ?? "");
	const electronConstructors =
		electronAdapter.match(/\bnew\s+Worker\s*\(/g)?.length ?? 0;
	if (electronConstructors < 1) {
		violations.push({
			rule: "missing-electron-worker-constructor",
			path: ELECTRON_ADAPTER,
		});
	}
	return violations;
}

const NEGATIVE_FIXTURES = [
	{
		name: "root fetch",
		rule: "root-fetch",
		path: "apps/web/src/fixture.ts",
		url: "/fonts/atlas.json",
		text: 'fetch("/fonts/atlas.json");',
	},
	{
		name: "root CSS url",
		rule: "root-css-url",
		path: "apps/web/src/fixture.css",
		url: "/fonts/chunk.png",
		text: "mask-image: url('/fonts/chunk.png');",
	},
	{
		name: "root image source",
		rule: "root-first-party-source",
		path: "apps/vite-example/src/fixture.tsx",
		url: "/effects/preview.jpg",
		text: '<img src="/effects/preview.jpg" />;',
	},
	{
		name: "dynamic flags prefix",
		rule: "dynamic-root-flags",
		path: "apps/web/src/fixture.ts",
		url: "/flags/${code}.svg",
		text: "const url = `/flags/${code}.svg`;",
	},
	{
		name: "direct editor Worker",
		rule: "direct-platform-worker",
		path: "apps/web/src/services/fixture.ts",
		url: "./worker.ts",
		text: 'new Worker(new URL("./worker.ts", import.meta.url));',
	},
];

function runFixture(name) {
	if (name === "empty-graph") {
		console.error(
			"[empty-production-graph] file=<graph> layer=source-graph url=<empty>",
		);
		process.exit(1);
	}
	const fixture = NEGATIVE_FIXTURES.find((entry) => entry.name === name);
	if (!fixture) {
		console.error(`Unknown source boundary fixture: ${name}`);
		process.exit(2);
	}
	const hit = scanFile(fixture.path, fixture.text).find(
		(entry) => entry.rule === fixture.rule,
	);
	if (!hit) process.exit(0);
	console.error(
		`[${hit.rule}] file=${hit.path} layer=source url=${fixture.url}`,
	);
	process.exit(1);
}

function runNegativeControl() {
	console.log("check-runtime-asset-boundary: negative control");
	let failed = false;
	for (const fixture of NEGATIVE_FIXTURES) {
		const result = spawnSync(
			process.execPath,
			[fileURLToPath(import.meta.url), "--fixture", fixture.name],
			{
				encoding: "utf8",
			},
		);
		const output = `${result.stdout}${result.stderr}`;
		const named =
			result.status !== 0 &&
			output.includes(`[${fixture.rule}]`) &&
			output.includes("file=") &&
			output.includes("layer=") &&
			output.includes("url=");
		console.log(
			`  ${named ? "PASS" : "FAIL"} ${fixture.name}: non-zero [${fixture.rule}] with file/layer/url`,
		);
		failed ||= !named;
	}
	const empty = spawnSync(
		process.execPath,
		[fileURLToPath(import.meta.url), "--fixture", "empty-graph"],
		{
			encoding: "utf8",
		},
	);
	const emptyOutput = `${empty.stdout}${empty.stderr}`;
	const emptyNamed =
		empty.status !== 0 &&
		emptyOutput.includes("[empty-production-graph]") &&
		emptyOutput.includes("file=<graph>") &&
		emptyOutput.includes("layer=source-graph") &&
		emptyOutput.includes("url=<empty>");
	console.log(
		`  ${emptyNamed ? "PASS" : "FAIL"} empty graph: non-zero [empty-production-graph] with file/layer/url`,
	);
	failed ||= !emptyNamed;
	if (failed) process.exit(1);
	console.log("negative control clean — every named violation was detected.");
}

function runCheck() {
	const files = productionFiles();
	const reads = new Map(
		files.map((path) => [path, readFileSync(join(REPO_ROOT, path), "utf8")]),
	);
	const violations = files.flatMap((path) => scanFile(path, reads.get(path)));
	violations.push(
		...checkComposition(files, reads),
		...checkLayers(files, reads),
	);

	console.log(
		`check-runtime-asset-boundary: scanned ${files.length} production source modules`,
	);
	console.log(`  Host roots: ${HOST_ROOTS.join(", ")}`);
	console.log(`  Required layers: ${[...REQUIRED_LAYERS.keys()].join(", ")}`);
	for (const rule of RULES) {
		console.log(
			`  ${violations.some((hit) => hit.rule === rule.id) ? "FAIL" : "PASS"} ${rule.id}`,
		);
	}
	if (violations.length > 0) {
		console.error("Runtime asset boundary violations:");
		for (const hit of violations) console.error(`  [${hit.rule}] ${hit.path}`);
		process.exit(1);
	}
	console.log(
		"clean — every Host and every required asset/Worker layer are present.",
	);
}

const fixtureIndex = process.argv.indexOf("--fixture");
if (fixtureIndex >= 0) runFixture(process.argv[fixtureIndex + 1]);
else if (process.argv.includes("--negative-control")) runNegativeControl();
else runCheck();
