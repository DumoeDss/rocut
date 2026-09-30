#!/usr/bin/env node

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { format } from "prettier";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = join(
	REPO_ROOT,
	"docs",
	"motion-text",
	"jizura-preset-catalog.json",
);
const DEFAULT_PLANNER_OUTPUT = join(
	REPO_ROOT,
	"rust",
	"crates",
	"motion-text",
	"resources",
	"jizura-planner-catalog.json",
);

function argument(name, fallback) {
	const prefix = `--${name}=`;
	const inline = process.argv.find((value) => value.startsWith(prefix));
	if (inline) return inline.slice(prefix.length);
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? fallback : process.argv[index + 1];
}

const sourceArgument = argument("source", null);
const sourceRoot = sourceArgument ? resolve(sourceArgument) : null;
const outputPath = resolve(argument("output", DEFAULT_OUTPUT));
const plannerOutputPath = resolve(
	argument("planner-output", DEFAULT_PLANNER_OUTPUT),
);
const revision = argument("revision", null);

if (!sourceRoot) {
	console.error(
		"Usage: node script/audit-jizura-registry.mjs --source <JIZURA checkout> [--output <file>] [--revision <git sha>]",
	);
	process.exit(2);
}

const sourceDirectory = join(sourceRoot, "src");
const sourceFiles = readdirSync(sourceDirectory)
	.filter(
		(name) =>
			/^0[1-8].*\.js$/u.test(name) ||
			/^11p_.*\.js$/u.test(name) ||
			name === "11q_sets.js",
	)
	.sort();

if (
	!sourceFiles.includes("05b_registry.js") ||
	!sourceFiles.includes("11q_sets.js")
) {
	console.error(
		`The source directory does not look like JIZURA: ${sourceDirectory}`,
	);
	process.exit(2);
}

function canvasContextStub() {
	return new Proxy(
		{
			canvas: { width: 1, height: 1 },
			measureText: (text) => ({
				actualBoundingBoxAscent: 10,
				actualBoundingBoxDescent: 2,
				actualBoundingBoxLeft: 0,
				actualBoundingBoxRight: String(text).length * 8,
				width: String(text).length * 8,
			}),
		},
		{
			get(target, property) {
				if (property in target) return target[property];
				return () => undefined;
			},
		},
	);
}

function canvasStub() {
	const context = canvasContextStub();
	const canvas = {
		height: 1,
		width: 1,
		getContext: () => context,
	};
	context.canvas = canvas;
	return canvas;
}

class ImageDataStub {
	constructor(width = 1, height = 1) {
		this.width = width;
		this.height = height;
		this.data = new Uint8ClampedArray(width * height * 4);
	}
}

const documentStub = {
	createElement: (tagName) =>
		tagName === "canvas"
			? canvasStub()
			: {
					rel: "",
					href: "",
					crossOrigin: "",
				},
	fonts: {
		add: () => undefined,
		load: async () => [],
		ready: Promise.resolve(),
	},
	head: { appendChild: () => undefined },
};

const warnings = [];
const sandbox = {
	console: {
		...console,
		warn: (...values) => warnings.push(values.map(String).join(" ")),
	},
	document: documentStub,
	FontFace: class FontFaceStub {},
	ImageData: ImageDataStub,
	localStorage: {
		getItem: () => null,
		removeItem: () => undefined,
		setItem: () => undefined,
	},
	navigator: { language: "ja-JP" },
	Path2D: class Path2DStub {},
	performance,
	setTimeout,
	clearTimeout,
	Uint8ClampedArray,
	window: {},
};

vm.createContext(sandbox);

const registrationSources = new Map();
let currentSource = null;

for (const sourceFile of sourceFiles) {
	currentSource = sourceFile;
	vm.runInContext(
		readFileSync(join(sourceDirectory, sourceFile), "utf8"),
		sandbox,
		{ filename: sourceFile },
	);

	if (sourceFile === "05b_registry.js") {
		const originalRegister = sandbox.window.J.register;
		sandbox.window.J.register = (group, key, definition, pack) => {
			registrationSources.set(`${group}:${key}`, currentSource);
			return originalRegister(group, key, definition, pack);
		};
	}
}

const J = sandbox.window.J;
const fontKeys = new Set(Object.keys(J.FONTS));

function serializable(value, seen = new Set()) {
	if (
		value === null ||
		["string", "number", "boolean"].includes(typeof value)
	) {
		return value;
	}
	if (typeof value === "function" || value === undefined) return undefined;
	if (seen.has(value)) return "[circular]";
	seen.add(value);
	if (Array.isArray(value)) {
		const result = value.map((entry) => serializable(entry, seen));
		seen.delete(value);
		return result;
	}
	const result = {};
	for (const key of Object.keys(value).sort()) {
		const next = serializable(value[key], seen);
		if (next !== undefined) result[key] = next;
	}
	seen.delete(value);
	return result;
}

function collectFontRefs(value, result = new Set(), seen = new Set()) {
	if (typeof value === "string" && fontKeys.has(value)) result.add(value);
	if (!value || typeof value !== "object" || seen.has(value)) return result;
	seen.add(value);
	for (const child of Array.isArray(value) ? value : Object.values(value)) {
		collectFontRefs(child, result, seen);
	}
	return result;
}

const legacySources = {
	decor: "07_decor.js",
	enter: "05_anim.js",
	exit: "05_anim.js",
	font: "02_fonts.js",
	hold: "05_anim.js",
	layout: "06_layouts.js",
	style: "04_styles.js",
};

const PLANNER_GROUPS = new Set([
	"style",
	"layout",
	"enter",
	"hold",
	"exit",
	"decor",
	"treat",
	"bg",
	"cam",
	"fx",
	"trans",
]);
const TICKS_PER_SECOND = 100_000;

function finitePositive(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function fitBounds(definition) {
	if (typeof definition.fits !== "function") return {};
	const accepted = [];
	for (let count = 0; count <= 256; count += 1) {
		try {
			if (definition.fits(count)) accepted.push(count);
		} catch (error) {
			warnings.push(`fits(${count}) failed: ${String(error)}`);
			return {};
		}
	}
	if (accepted.length === 0) return { selectable: false };
	const minChars = accepted[0];
	const maxChars = accepted.at(-1);
	const contiguous = accepted.length === maxChars - minChars + 1;
	if (!contiguous) {
		warnings.push(
			"A planner fits(n) constraint was non-contiguous and was not reduced.",
		);
		return {};
	}
	return {
		...(minChars > 0 ? { minChars } : {}),
		...(maxChars < 256 ? { maxChars } : {}),
	};
}

function plannerChoice(group, id, definition) {
	if (!PLANNER_GROUPS.has(group) || definition.special === true) return null;
	const bounds = group === "layout" ? fitBounds(definition) : {};
	if (bounds.selectable === false) return null;
	const maxChars = finitePositive(definition.maxChars)
		? Math.trunc(definition.maxChars)
		: bounds.maxChars;
	return {
		group,
		id,
		weight: finitePositive(definition.w) ? definition.w : 1,
		...(bounds.minChars !== undefined ? { minChars: bounds.minChars } : {}),
		...(maxChars !== undefined ? { maxChars } : {}),
		...(finitePositive(definition.minDur)
			? { minDuration: Math.round(definition.minDur * TICKS_PER_SECOND) }
			: {}),
	};
}

function entry(group, key, definition, orderIndex) {
	const functionFields = Object.keys(definition)
		.filter((field) => typeof definition[field] === "function")
		.sort();
	const metadata = serializable(definition);
	return {
		group,
		id: key,
		name: definition.label ?? definition.name ?? key,
		pack: definition.pack ?? "core",
		set: definition.set ?? null,
		orderIndex,
		sourceFile:
			registrationSources.get(`${group}:${key}`) ??
			legacySources[group] ??
			"05b_registry.js",
		implementation:
			functionFields.length > 0
				? definition.builtin
					? "builtin-and-functions"
					: "functions"
				: definition.builtin
					? "builtin"
					: "metadata",
		functionFields,
		explicitFontRefs: [...collectFontRefs(definition)].sort(),
		plannerChoice: plannerChoice(group, key, definition),
		metadata,
	};
}

const groups = ["style", "font", ...J.GROUP_KEYS];
const registries = {
	style: J.STYLES,
	font: J.FONTS,
	...Object.fromEntries(
		J.GROUP_KEYS.map((group) => [group, J.registry(group)]),
	),
};
const orders = {
	style: J.STYLE_ORDER,
	font: Object.keys(J.FONTS),
	...Object.fromEntries(J.GROUP_KEYS.map((group) => [group, J.order(group)])),
};

const entries = [];
const counts = {};
for (const group of groups) {
	const registry = registries[group];
	const order = orders[group];
	const orderedKeys = [
		...order,
		...Object.keys(registry)
			.filter((key) => !order.includes(key))
			.sort(),
	];
	counts[group] = orderedKeys.length;
	for (const [orderIndex, key] of orderedKeys.entries()) {
		entries.push(entry(group, key, registry[key], orderIndex));
	}
}

const catalog = {
	schemaVersion: 1,
	generatedBy: "script/audit-jizura-registry.mjs",
	source: {
		name: "JIZURA",
		version: readFileSync(join(sourceRoot, "VERSION"), "utf8").trim(),
		revision,
		loadedFiles: sourceFiles,
	},
	counts: {
		...counts,
		total: entries.length,
	},
	warnings,
	entries,
	plannerChoices: entries
		.map((value) => value.plannerChoice)
		.filter((value) => value !== null),
};

const plannerCatalog = {
	schemaVersion: 1,
	generatedBy: "script/audit-jizura-registry.mjs",
	source: catalog.source,
	choices: entries.flatMap((value) =>
		value.plannerChoice
			? [
					{
						...value.plannerChoice,
						presetSet: value.set,
					},
				]
			: [],
	),
};

mkdirSync(dirname(outputPath), { recursive: true });
const formattedCatalog = await format(JSON.stringify(catalog), {
	parser: "json",
	useTabs: true,
});
writeFileSync(outputPath, formattedCatalog, "utf8");
mkdirSync(dirname(plannerOutputPath), { recursive: true });
const formattedPlannerCatalog = await format(JSON.stringify(plannerCatalog), {
	parser: "json",
	useTabs: true,
});
writeFileSync(plannerOutputPath, formattedPlannerCatalog, "utf8");
console.log(
	`JIZURA registry: ${entries.length} entries across ${groups.length} groups -> ${outputPath}`,
);
console.log(
	`  planner ${plannerCatalog.choices.length} choices -> ${plannerOutputPath}`,
);
for (const group of groups)
	console.log(`  ${group.padEnd(7)} ${counts[group]}`);
if (warnings.length > 0) console.log(`  warnings ${warnings.length}`);
