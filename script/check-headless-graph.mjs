import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const SHA256 = /^[0-9a-f]{64}$/;

function slash(value) {
	return String(value).replaceAll("\\", "/");
}

export function normalizeHeadlessModuleId(value, repositoryRoot) {
	let normalized = slash(value).replace(/^file:\/\//i, "");
	const suffixIndex = normalized.search(/[?#]/);
	const pathPart =
		suffixIndex < 0 ? normalized : normalized.slice(0, suffixIndex);
	const suffix = suffixIndex < 0 ? "" : normalized.slice(suffixIndex);
	if (repositoryRoot && /^[a-z]:\//i.test(pathPart)) {
		const relativePath = slash(relative(repositoryRoot, pathPart));
		if (!relativePath.startsWith("../")) normalized = relativePath + suffix;
	}
	return normalized;
}

function canonicalModules(items) {
	return items
		.map((item) => ({
			id: normalizeHeadlessModuleId(item.id),
			rawIds: [...new Set((item.rawIds ?? []).map(slash))].sort(),
			chunks: [...new Set((item.chunks ?? []).map(slash))].sort(),
		}))
		.sort((left, right) =>
			`${left.id}\0${left.rawIds.join("\0")}`.localeCompare(
				`${right.id}\0${right.rawIds.join("\0")}`,
			),
		);
}

export function canonicalHeadlessModuleDigest(items) {
	return createHash("sha256")
		.update(JSON.stringify(canonicalModules(items)))
		.digest("hex");
}

function canonicalOutputs(files) {
	return files
		.map((file) => ({ path: slash(file.path), sha256: file.sha256 }))
		.sort((left, right) => left.path.localeCompare(right.path));
}

export function canonicalHeadlessOutputDigest(files) {
	return createHash("sha256")
		.update(JSON.stringify(canonicalOutputs(files)))
		.digest("hex");
}

function canonicalJson(value) {
	if (Array.isArray(value)) return value.map(canonicalJson);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, canonicalJson(child)]),
		);
	}
	return value;
}

export function canonicalHeadlessGraphDigest(envelope) {
	return createHash("sha256")
		.update(JSON.stringify(canonicalJson(envelope)))
		.digest("hex");
}

export class HeadlessGraphCheckError extends Error {
	constructor(message, report) {
		super(message);
		this.name = "HeadlessGraphCheckError";
		this.report = report;
	}
}

function fileSha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function htmlAttribute(attributes, name) {
	const pattern = new RegExp(
		`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`,
		"i",
	);
	const match = pattern.exec(attributes);
	return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function resolveFacadeScript({ src, facadePath, outputNames }) {
	try {
		const origin = "https://c7-headless.invalid";
		const url = new URL(
			src,
			`${origin}/${slash(facadePath).replace(/^\/+/, "")}`,
		);
		if (url.origin !== origin) return null;
		const pathname = decodeURIComponent(url.pathname).replaceAll("\\", "/");
		const exact = pathname.replace(/^\/+/, "");
		if (outputNames.has(exact)) return exact;
		const suffixMatches = [...outputNames].filter((path) =>
			pathname.endsWith(`/${path}`),
		);
		return suffixMatches.length === 1 ? suffixMatches[0] : null;
	} catch {
		return null;
	}
}

function inspectHtmlFacade({ html, facadePath, outputNames }) {
	const scripts = [];
	const tags = html.matchAll(/<script\b([^>]*)>/gi);
	for (const tag of tags) {
		const attributes = tag[1] ?? "";
		const src = htmlAttribute(attributes, "src");
		const type = htmlAttribute(attributes, "type") ?? "";
		scripts.push({
			src,
			type,
			outputPath:
				src === null
					? null
					: resolveFacadeScript({ src, facadePath, outputNames }),
		});
	}
	return scripts;
}

function canonicalFacadeScripts(scripts) {
	return scripts.map((script) => ({
		src: script?.src ?? null,
		type: script?.type ?? "",
		outputPath: script?.outputPath ?? null,
	}));
}

const REQUIRED_ROOTS = [
	{
		name: "runtime probe",
		ids: ["apps/web/src/editor/session/headless-runtime-probe.ts"],
	},
	{
		name: "semantic fixture",
		ids: ["apps/web/src/editor/session/headless-semantic-fixture.ts"],
	},
	{
		name: "isolated headless owner",
		ids: ["apps/web/src/editor/session/headless.ts"],
	},
	{
		name: "shared migration gate",
		ids: ["apps/web/src/editor/session/migration-gate.ts"],
	},
	{
		name: "persistence coordinator",
		ids: ["apps/web/src/editor/persistence/session-persistence-coordinator.ts"],
	},
	{
		name: "project codec",
		ids: ["apps/web/src/editor/persistence/project-codec.ts"],
	},
	{
		name: "opaque overlay",
		ids: ["apps/web/src/editor/persistence/opaque-value.ts"],
	},
	{
		name: "Host contract",
		ids: ["apps/web/src/editor/host/editor-host.ts"],
	},
	{
		name: "store contract",
		ids: ["apps/web/src/editor/ports/project-store.ts"],
	},
	{
		name: "in-memory store",
		ids: ["apps/web/src/editor/ports/in-memory/index.ts"],
	},
	{
		name: "in-memory Host",
		ids: ["apps/web/src/editor/ports/in-memory/host.ts"],
	},
];

function comparableModuleId(value) {
	return normalizeHeadlessModuleId(value).replace(/[?#].*$/, "");
}

function matchesRequired(moduleId, expected) {
	const comparable = comparableModuleId(moduleId);
	return comparable === expected || comparable.endsWith(`/${expected}`);
}

function forbiddenRule(item) {
	const identities = [item.id, ...(item.rawIds ?? [])]
		.map((value) => slash(value).toLowerCase())
		.join("\n");
	const reactFamily =
		/(^|[/\0:])react(?:-dom)?(?:[/\0:#?]|$)/m.test(identities) ||
		/(^|[/\0:])(?:jsx|react-jsx)-runtime(?:[/\0:#?]|$)/m.test(identities) ||
		/(^|[/\0:])react-server(?:[/\0:#?]|$)/m.test(identities) ||
		/(^|[/\0:])scheduler(?:[/\0:#?]|$)/m.test(identities);
	if (reactFamily) return "react-family";
	if (/(^|[/\0:])sonner(?:[/\0:#?]|$)/m.test(identities)) return "sonner";
	if (
		identities.includes("apps/web/src/editor/session/index.ts") ||
		identities.includes("editor-session-provider") ||
		identities.includes("editor-session-host") ||
		identities.includes("session-core-owner") ||
		identities.includes("apps/web/src/core/index.ts") ||
		identities.includes("browser-project-store") ||
		/(^|[/\0])surface(?:[./\0]|$)/m.test(identities)
	) {
		return "full-editor-or-browser-composition";
	}
	return null;
}

function push(issues, condition, rule, message, details = {}) {
	if (!condition) issues.push({ rule, message, ...details });
}

function failureReport(envelope, issues) {
	return {
		schemaVersion: 1,
		ok: false,
		exitCode: 1,
		host: typeof envelope?.host === "string" ? envelope.host : null,
		graphSha256: canonicalHeadlessGraphDigest(envelope),
		issueCount: issues.length,
		summary: `C7 headless graph rejected by ${issues.length} rule${issues.length === 1 ? "" : "s"}`,
		issues,
	};
}

function rejectGraph(envelope, category, issues) {
	const report = failureReport(envelope, issues);
	throw new HeadlessGraphCheckError(
		`C7 headless graph ${category}: ${issues
			.map((issue) => `${issue.rule}: ${issue.message}`)
			.join("; ")}`,
		report,
	);
}

export function checkHeadlessGraphEnvelope(envelope, expected) {
	const issues = [];
	push(
		issues,
		envelope?.schemaVersion === 1,
		"schema.version",
		"schemaVersion must be 1",
	);
	push(
		issues,
		envelope?.host === expected.host,
		"identity.host",
		"Host identity does not match",
	);
	push(
		issues,
		envelope?.producer === expected.producer,
		"identity.producer",
		"producer identity does not match",
	);
	push(
		issues,
		envelope?.entry?.expected === expected.entry &&
			envelope?.entry?.observed === expected.entry &&
			envelope?.entry?.matchCount === 1 &&
			envelope?.entry?.emitted === true,
		"entry.exact-emitted",
		"exact entry must be present once and emitted",
	);
	push(
		issues,
		envelope?.acceptedBase?.head === expected.acceptedHead,
		"base.head",
		"accepted HEAD does not match",
	);
	push(
		issues,
		envelope?.acceptedBase?.tree === expected.acceptedTree,
		"base.tree",
		"accepted tree does not match",
	);
	push(
		issues,
		envelope?.build?.marker === expected.marker,
		"build.marker",
		"build marker does not match",
	);
	push(
		issues,
		text(envelope?.build?.id),
		"build.id",
		"build identity is empty",
	);
	push(
		issues,
		text(envelope?.build?.mode),
		"build.mode",
		"build mode is empty",
	);
	push(
		issues,
		envelope?.attribution?.exactRoot === true,
		"attribution.exact-root",
		"exact-root attribution is absent",
	);
	push(
		issues,
		envelope?.attribution?.dependencyEdges === true,
		"attribution.dependency-edges",
		"dependency-edge reachability is absent",
	);
	push(
		issues,
		envelope?.attribution?.emittedIntersection === true,
		"attribution.emitted-intersection",
		"emitted membership intersection is absent",
	);

	const items = Array.isArray(envelope?.modules?.items)
		? envelope.modules.items
		: [];
	push(
		issues,
		items.length > 0,
		"modules.nonempty",
		"module inventory is empty",
	);
	push(
		issues,
		envelope?.modules?.count === items.length,
		"modules.count",
		"module count does not match inventory",
	);
	push(
		issues,
		envelope?.modules?.moduleSetSha256 === canonicalHeadlessModuleDigest(items),
		"modules.digest",
		"canonical module-set digest does not match",
	);
	for (const item of items) {
		push(issues, text(item?.id), "modules.id", "module id is empty");
		push(
			issues,
			Array.isArray(item?.rawIds) && item.rawIds.length > 0,
			"modules.raw-identities",
			`module ${String(item?.id)} has no retained raw identity`,
			{ moduleId: item?.id ?? null },
		);
		push(
			issues,
			Array.isArray(item?.chunks) && item.chunks.length > 0,
			"modules.chunk-membership",
			`module ${String(item?.id)} has no emitted chunk membership`,
			{ moduleId: item?.id ?? null },
		);
	}

	const files = Array.isArray(envelope?.output?.files)
		? envelope.output.files
		: [];
	push(
		issues,
		files.length > 0,
		"output.nonempty",
		"emitted output file inventory is empty",
	);
	push(
		issues,
		envelope?.output?.fileSetSha256 === canonicalHeadlessOutputDigest(files),
		"output.digest",
		"canonical output-set digest does not match",
	);
	const outputRoot =
		expected.outputRoot ??
		(isAbsolute(envelope?.output?.root ?? "")
			? envelope.output.root
			: resolve(expected.repositoryRoot, envelope?.output?.root ?? ""));
	const outputNames = new Set(files.map((file) => slash(file.path)));
	for (const file of files) {
		push(
			issues,
			text(file?.path),
			"output.file-path",
			"emitted file path is empty",
		);
		push(
			issues,
			SHA256.test(file?.sha256 ?? ""),
			"output.file-digest-format",
			"emitted file digest is invalid",
			{ outputPath: file?.path ?? null },
		);
		const absolute = resolve(outputRoot, file.path ?? "");
		push(
			issues,
			existsSync(absolute),
			"output.file-missing",
			`emitted file is missing: ${file.path}`,
			{ outputPath: file?.path ?? null },
		);
		if (existsSync(absolute)) {
			push(
				issues,
				fileSha256(absolute) === file.sha256,
				"output.file-digest-changed",
				`emitted file digest changed: ${file.path}`,
				{ outputPath: file?.path ?? null },
			);
		}
	}
	for (const item of items) {
		for (const chunk of item.chunks ?? []) {
			push(
				issues,
				outputNames.has(slash(chunk)),
				"output.chunk-inventory",
				`module chunk is absent from emitted files: ${chunk}`,
				{ moduleId: item.id, outputPath: chunk },
			);
		}
	}

	if (envelope?.host === "vite") {
		const facade = envelope?.output?.facade;
		const facadePath = slash(facade?.path ?? "");
		push(
			issues,
			facadePath === "headless.html",
			"facade.html-path",
			"Vite executable HTML facade must be headless.html",
			{ outputPath: facadePath || null },
		);
		push(
			issues,
			SHA256.test(facade?.sha256 ?? ""),
			"facade.html-digest-format",
			"Vite executable HTML facade digest is invalid",
			{ outputPath: facadePath || null },
		);
		const facadeFile = files.find((file) => slash(file.path) === facadePath);
		push(
			issues,
			Boolean(facadeFile),
			"facade.html-inventory",
			"Vite executable HTML facade is absent from emitted files",
			{ outputPath: facadePath || null },
		);
		push(
			issues,
			Boolean(facadeFile) && facadeFile?.sha256 === facade?.sha256,
			"facade.html-digest",
			"Vite executable HTML facade digest does not match output inventory",
			{ outputPath: facadePath || null },
		);

		const recordedScripts = Array.isArray(facade?.scripts)
			? canonicalFacadeScripts(facade.scripts)
			: [];
		const absoluteFacade = facadePath ? resolve(outputRoot, facadePath) : null;
		const observedScripts =
			absoluteFacade && existsSync(absoluteFacade)
				? inspectHtmlFacade({
						html: readFileSync(absoluteFacade, "utf8"),
						facadePath,
						outputNames,
					})
				: [];
		push(
			issues,
			recordedScripts.length > 0,
			"facade.scripts-nonempty",
			"Vite executable HTML facade has no recorded scripts",
		);
		push(
			issues,
			JSON.stringify(recordedScripts) === JSON.stringify(observedScripts),
			"facade.scripts-observed",
			"Vite executable HTML facade scripts do not match emitted HTML",
		);
		push(
			issues,
			observedScripts.every((script) => text(script.outputPath)),
			"facade.scripts-emitted",
			"Vite executable HTML facade references a script outside emitted output",
		);

		const entryChunks = [
			...new Set(
				items
					.filter((item) => matchesRequired(item.id, expected.entry))
					.flatMap((item) => item.chunks ?? [])
					.map(slash),
			),
		].sort();
		const recordedEntryChunks = Array.isArray(facade?.entryChunks)
			? [...new Set(facade.entryChunks.map(slash))].sort()
			: [];
		push(
			issues,
			entryChunks.length > 0 &&
				JSON.stringify(recordedEntryChunks) === JSON.stringify(entryChunks),
			"facade.entry-chunks",
			"Vite HTML facade entry chunks do not match exact-root membership",
		);
		push(
			issues,
			observedScripts.some(
				(script) =>
					script.type.toLowerCase() === "module" &&
					entryChunks.includes(script.outputPath),
			),
			"facade.entry-script",
			"Vite executable HTML facade has no module script linked to the exact entry chunk",
		);
	}

	const moduleIds = items.map((item) => item.id);
	for (const root of REQUIRED_ROOTS) {
		push(
			issues,
			root.ids.some((requiredId) =>
				moduleIds.some((moduleId) => matchesRequired(moduleId, requiredId)),
			),
			"roots.required",
			`required root is absent: ${root.name}`,
			{ requiredRoot: root.name },
		);
	}
	push(
		issues,
		moduleIds.some((moduleId) => matchesRequired(moduleId, expected.entry)),
		"roots.entry",
		"required root is absent: exact application entry",
		{ requiredRoot: expected.entry },
	);

	if (issues.length > 0) {
		rejectGraph(envelope, "integrity rejected", issues);
	}

	const forbidden = items.flatMap((item) => {
		const rule = forbiddenRule(item);
		return rule ? [{ rule, id: item.id, rawIds: item.rawIds }] : [];
	});
	if (forbidden.length > 0) {
		rejectGraph(
			envelope,
			"forbidden modules",
			forbidden.map((item) => ({
				rule: `forbidden.${item.rule}`,
				message: `${item.rule}: ${item.id} [${item.rawIds.join(", ")}]`,
				moduleId: item.id,
				rawIds: item.rawIds,
			})),
		);
	}
	return {
		schemaVersion: 1,
		ok: true,
		exitCode: 0,
		host: envelope.host,
		graphSha256: canonicalHeadlessGraphDigest(envelope),
		moduleCount: items.length,
		forbiddenCount: 0,
		issues: [],
		summary: `C7 ${envelope.host} headless graph accepted with ${items.length} emitted modules`,
		moduleSetSha256: envelope.modules.moduleSetSha256,
		fileSetSha256: envelope.output.fileSetSha256,
	};
}

function text(value) {
	return typeof value === "string" && value.length > 0;
}

function parseArguments(values) {
	const parsed = { envelopePath: values[0] };
	for (let index = 1; index < values.length; index += 2) {
		parsed[values[index]?.replace(/^--/, "")] = values[index + 1];
	}
	return parsed;
}

if (
	process.argv[1] &&
	basename(process.argv[1]) === basename(import.meta.url)
) {
	const args = parseArguments(process.argv.slice(2));
	if (!args.envelopePath) {
		console.error(
			"usage: node script/check-headless-graph.mjs <envelope> --host <host> --producer <producer> --entry <entry> --marker <marker> --head <head> --tree <tree>",
		);
		process.exit(2);
	}
	const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	try {
		const envelopePath = resolve(repositoryRoot, args.envelopePath);
		const envelope = JSON.parse(readFileSync(envelopePath, "utf8"));
		const result = checkHeadlessGraphEnvelope(envelope, {
			host: args.host,
			producer: args.producer,
			entry: args.entry,
			marker: args.marker,
			acceptedHead: args.head,
			acceptedTree: args.tree,
			repositoryRoot,
		});
		console.log(JSON.stringify(result, null, 2));
	} catch (error) {
		if (error instanceof HeadlessGraphCheckError) {
			console.error(JSON.stringify(error.report));
		}
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
