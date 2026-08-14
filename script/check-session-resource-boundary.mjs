#!/usr/bin/env node
/**
 * C6 resource-acquisition boundary.
 *
 * The inventory is deliberately rooted at the whole editor source tree —
 * see SCAN_ROOTS below, which is a superset of SOURCE_ROOT covering both the
 * shared editor packages and the residual Host-owned apps/web/src shell.  A
 * directory is never exempted: a reviewed exception names one construct (and
 * its reason), while every other direct platform acquisition is reported.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
	canonicalStringSetDigest,
	collectNextEditorArtifactDigests,
	collectNextEditorModuleIds,
	sha256File,
	summarizeNextEditorModules,
} from "./collect-next-editor-module-ids.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
// S05 P1 Stage C moved the editor runtime graph (session resources registry,
// shared session entry, and every REQUIRED_ROOTS directory below) out of
// apps/web/src into @opencut/editor-classic. SOURCE_ROOT anchors the required
// -root/closure math to the tree that now actually holds them; the residual
// apps/web/src Host shell (next-editor-host.ts, the Next-only probe, and a
// handful of standalone Host pages) is still scanned — see SCAN_ROOTS below —
// it is just no longer where the required domains live.
const SOURCE_ROOT = "packages/editor-classic/src";
const REGISTRY = "packages/editor-classic/src/editor/session/session-resources.ts";
const SHARED_SESSION_ENTRY =
	"packages/editor-classic/src/editor/session/create-session.ts";
const HOST_ENTRIES = {
	vite: "apps/vite-example/src/host/vite-host-config.ts",
	next: "apps/web/src/editor/host/next-editor-host.ts",
};
/**
 * Modules attributable to the shared editor packages, as opposed to a Host's
 * own wrapper code (apps/web/src, apps/vite-example/src). Both the checker and
 * the closure generator/anchor need this same distinction: it is what
 * "web source" meant before Stage C, now made explicit because the shared
 * code no longer lives under a Host's own apps/web/src.
 */
const EDITOR_PACKAGE_PREFIXES = [
	"packages/editor-classic/src/",
	"packages/editor-ports/src/",
];
function isEditorPackageModule(moduleId) {
	return EDITOR_PACKAGE_PREFIXES.some((prefix) => moduleId.startsWith(prefix));
}
/**
 * Roots the direct-acquisition scan walks. SOURCE_ROOT alone would miss the
 * residual Host-owned apps/web/src files that still carry their own
 * CONSTRUCT_EXEMPTIONS entries (the Next-only readiness probe, the
 * changelog button, the brand page, and next-editor-host.ts itself) — those
 * never moved, so the scan still has to cover apps/web/src as well as the
 * two packages the runtime graph moved into.
 */
const SCAN_ROOTS = [
	"apps/web/src",
	"packages/editor-classic/src",
	"packages/editor-ports/src",
];
const EXPECTED_CLOSURE_PATH = process.env.C6_EXPECTED_CLOSURE
	? resolve(ROOT, process.env.C6_EXPECTED_CLOSURE)
	: join(ROOT, "script/fixtures/c6-session-resource-expected-closure.json");
const EXPECTED_CLOSURE = JSON.parse(
	readFileSync(EXPECTED_CLOSURE_PATH, "utf8"),
);
const EXPECTED_CLOSURE_ANCHOR_REPOSITORY_PATH =
	"script/fixtures/c6-session-resource-closure-anchor.json";
const EXPECTED_CLOSURE_ANCHOR_PATH = join(
	ROOT,
	EXPECTED_CLOSURE_ANCHOR_REPOSITORY_PATH,
);
const EXPECTED_CLOSURE_ANCHOR = JSON.parse(
	readFileSync(EXPECTED_CLOSURE_ANCHOR_PATH, "utf8"),
);
const EXPECTED_CLOSURE_SHA256 =
	"703efb9c37906b108ff91a8702606ec6a214a4c793476378fd043a94dff20cea";
const EXPECTED_COMMON_SOURCE_COUNT = 272;
const REQUIRED_ROOTS = [
	"components/editor",
	"preview",
	"selection",
	"timeline",
	"sounds",
	"export",
	"utils",
	"core",
	"editor",
	"media",
	"retime",
	"services/renderer",
	"services/transcription",
	"services/video-cache",
	"services/waveform-cache",
];
const EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const RULES = [
	{
		id: "no-direct-timer",
		// Enforced by the TypeScript value-flow pass below.
		test: () => false,
	},
	{
		id: "no-direct-worker",
		// Enforced by the TypeScript value-flow pass below.
		test: () => false,
	},
	{
		id: "no-direct-audio",
		// Enforced by the TypeScript value-flow pass below.
		test: () => false,
	},
	{
		id: "no-direct-object-url",
		// Enforced by the TypeScript value-flow pass below.
		test: () => false,
	},
	{
		id: "no-offline-escape",
		// Enforced by the TypeScript AST pass below. A line regex cannot prove
		// awaited terminal rendering or prevent value escape.
		test: () => false,
	},
	{
		id: "no-unkeyed-compositor",
		test: (line) =>
			/\bcreateCompositor\s*\(\s*\)/.test(line) ||
			/\b(?:initCompositor|resizeCompositor|getCompositorCanvas|uploadTexture|releaseTexture|renderFrame)\s*\(/.test(
				line,
			),
	},
	{
		id: "no-second-acquisition-mediator",
		// Enforced structurally below: names are intentionally irrelevant.
		test: () => false,
	},
];

const STRUCTURAL_MEDIATOR_EXEMPTIONS = new Map([
	[
		"packages/editor-classic/src/editor/host/browser-runtime.ts",
		"The reviewed Host adapter implements the platform construction boundary.",
	],
	[
		"packages/editor-ports/src/in-memory/index.ts",
		"The reviewed in-memory Host adapter implements conformance resources.",
	],
	[
		"packages/editor-classic/src/editor/session/c6-disposal-harness.tsx",
		"The reviewed browser fault harness constructs independent platform-ledger controls.",
	],
	[
		"packages/editor-classic/src/editor/session/independent-timer-ledger.ts",
		"The reviewed browser-oracle timer ledger wraps injected platform APIs solely for independent fault/accounting controls.",
	],
]);

const STRUCTURAL_WRAPPER_EXEMPTIONS = new Map([
	[
		"packages/editor-classic/src/media/persistence.ts",
		new Map([
			[
				"mediaAssetFromAttachment",
				"Reviewed retained MediaAsset construction transfers its exact object URL owner.",
			],
		]),
	],
	[
		"packages/editor-classic/src/services/storage/service.ts",
		new Map([
			[
				"loadMediaAsset",
				"Reviewed retained MediaAsset load transfers its exact object URL owner.",
			],
		]),
	],
]);

const OFFLINE_CONTEXT_ARGUMENT_ALLOWANCES = new Map([
	[
		"packages/editor-classic/src/media/audio-mastering.ts",
		new Set(["createAudioMasteringChain"]),
	],
	[
		"packages/editor-classic/src/retime/audio-stretch.ts",
		new Set(["PitchShifter"]),
	],
]);

/**
 * Exact construct exemptions.  The match is checked against the source line;
 * adding a new acquisition to an exempt file still fails unless it receives a
 * separately reviewed signature and reason.
 */
const CONSTRUCT_EXEMPTIONS = new Map([
	[
		"packages/editor-classic/src/editor/host/browser-runtime.ts",
		[
			{
				rule: "no-direct-worker",
				match: "new Worker(",
				why: "Host runtime constructs the Worker it owns",
			},
			{
				rule: "no-direct-audio",
				match: "new AudioContext(",
				why: "Host runtime constructs the AudioContext it owns",
			},
			{
				rule: "no-direct-object-url",
				match: "URL.createObjectURL(",
				why: "Host runtime owns browser object URL construction",
			},
		],
	],
	[
		"apps/web/src/editor/host/c4-next-runtime-probe.tsx",
		[
			{
				rule: "no-direct-timer",
				match: "window.setTimeout(",
				why: "Host-only readiness probe outside the editor session graph",
			},
		],
	],
	[
		"packages/editor-ports/src/conformance/index.ts",
		[
			{
				rule: "no-direct-timer",
				match: "setTimeout(",
				why: "Host-port conformance fixture",
			},
		],
	],
	[
		"packages/editor-ports/src/in-memory/index.ts",
		[
			{
				rule: "no-direct-audio",
				match: "new globalThis.AudioContext(",
				why: "In-memory Host conformance implementation uses an injected test AudioContext",
			},
		],
	],
	[
		"packages/editor-classic/src/editor/session/c6-disposal-harness.tsx",
		[
			{
				rule: "no-direct-timer",
				match: "originalSetTimeout(",
				why: "Reviewed browser fault ledger delegates to the captured platform timeout",
			},
			{
				rule: "no-direct-timer",
				match: "originalSetInterval(",
				why: "Reviewed browser fault ledger delegates to the captured platform interval",
			},
			{
				rule: "no-direct-timer",
				match: "originalRequestAnimationFrame(",
				why: "Reviewed browser fault ledger delegates to the captured platform frame callback",
			},
		],
	],
	[
		"packages/editor-classic/src/services/storage/browser-project-store-cascade-round2-probes.ts",
		[
			{
				rule: "no-direct-timer",
				match: "setTimeout(",
				why: "Storage probe controls its own bounded polling timeout",
			},
		],
	],
	[
		"packages/editor-classic/src/services/storage/browser-project-store-cascade-probes.ts",
		[
			{
				rule: "no-direct-timer",
				match: "setTimeout(",
				why: "Storage probe controls its own bounded polling timeout",
			},
		],
	],
	[
		"packages/editor-classic/src/services/storage/browser-project-store-migration-round2-probes.ts",
		[
			{
				rule: "no-direct-timer",
				match: "setTimeout(",
				why: "Storage migration probe delay",
			},
		],
	],
	[
		"packages/editor-classic/src/services/storage/migrations/runner.ts",
		[
			{
				rule: "no-direct-timer",
				match: "setTimeout(",
				why: "Migration UI minimum-display delay, not a live editor timer",
			},
		],
	],
	[
		"apps/web/src/changelog/components/copy-markdown-button.tsx",
		[
			{
				rule: "no-direct-timer",
				match: "setTimeout(",
				why: "Standalone changelog feedback UI",
			},
		],
	],
	[
		"apps/web/src/app/brand/page.tsx",
		[
			{
				rule: "no-direct-timer",
				match: "setTimeout(",
				why: "Standalone brand page feedback/download animation",
			},
		],
	],
	[
		"packages/editor-classic/src/components/ui/form.tsx",
		[
			{
				rule: "no-direct-timer",
				match: "setTimeout(",
				why: "Generic form debounce outside an editor session",
			},
		],
	],
	[
		"packages/editor-classic/src/core/managers/audio-manager.ts",
		[
			{
				rule: "no-offline-escape",
				match: "new OfflineAudioContext(",
				why: "Operation-bounded offline mastering context",
			},
		],
	],
	[
		"packages/editor-classic/src/media/audio-mastering.ts",
		[
			{
				rule: "no-offline-escape",
				match: "new OfflineAudioContext(",
				why: "Operation-bounded offline mastering context",
			},
		],
	],
	[
		"packages/editor-classic/src/media/audio.ts",
		[
			{
				rule: "no-offline-escape",
				match: "new OfflineAudioContext(",
				why: "Operation-bounded resampling context",
			},
		],
	],
	[
		"packages/editor-classic/src/retime/audio-stretch.ts",
		[
			{
				rule: "no-offline-escape",
				match: "new OfflineAudioContext(",
				why: "Operation-bounded retime context",
			},
		],
	],
]);

function normalize(path) {
	return path.replaceAll("\\", "/");
}

function validateExpectedClosureFixture() {
	if (EXPECTED_CLOSURE.schemaVersion !== 2) {
		throw new Error("C6 expected closure has an unsupported schema version");
	}
	if (EXPECTED_CLOSURE_ANCHOR.schemaVersion !== 1) {
		throw new Error("C6 independent closure anchor has an unsupported schema");
	}
	const canonicalPayload = JSON.stringify({
		requiredRoots: EXPECTED_CLOSURE.requiredRoots,
		common: EXPECTED_CLOSURE.common,
		hosts: EXPECTED_CLOSURE.hosts,
	});
	const actualDigest = createHash("sha256")
		.update(canonicalPayload)
		.digest("hex");
	if (
		EXPECTED_CLOSURE.integrity?.canonicalPayloadSha256 !==
			EXPECTED_CLOSURE_SHA256 ||
		actualDigest !== EXPECTED_CLOSURE_SHA256 ||
		EXPECTED_CLOSURE.common?.length !== EXPECTED_COMMON_SOURCE_COUNT ||
		EXPECTED_CLOSURE.integrity?.reviewedCommonSourceCount !==
			EXPECTED_COMMON_SOURCE_COUNT
	) {
		throw new Error(
			`C6 expected closure fixture integrity drifted (expected ${EXPECTED_CLOSURE_SHA256}, actual ${actualDigest})`,
		);
	}
	if (
		EXPECTED_CLOSURE.provenance?.baseCommit !==
			"488a8a8d3ded082813ff4636469e83c6a190a30a" ||
		EXPECTED_CLOSURE.provenance?.anchor !==
			EXPECTED_CLOSURE_ANCHOR_REPOSITORY_PATH ||
		!EXPECTED_CLOSURE.provenance?.vite?.artifact ||
		!EXPECTED_CLOSURE.provenance?.vite?.sha256 ||
		!EXPECTED_CLOSURE.provenance?.next?.artifact ||
		!EXPECTED_CLOSURE.provenance?.next?.sha256
	) {
		throw new Error("C6 expected closure fixture provenance is incomplete");
	}
	const anchoredClosure = EXPECTED_CLOSURE_ANCHOR.closure;
	const sourceClosureDigest = canonicalStringSetDigest(expectedSourceClosure());
	if (
		anchoredClosure?.canonicalPayloadSha256 !== EXPECTED_CLOSURE_SHA256 ||
		anchoredClosure?.commonSourceCount !== EXPECTED_COMMON_SOURCE_COUNT ||
		anchoredClosure?.sourceClosureCount !== sourceClosureDigest.count ||
		anchoredClosure?.sourceClosureSha256 !== sourceClosureDigest.sha256
	) {
		throw new Error(
			"C6 independent closure anchor rejects the checker/fixture closure",
		);
	}
	const anchoredVite = EXPECTED_CLOSURE_ANCHOR.artifacts?.vite;
	const anchoredNext = EXPECTED_CLOSURE_ANCHOR.artifacts?.next;
	if (
		EXPECTED_CLOSURE.provenance.vite.artifact !== anchoredVite?.moduleGraph ||
		EXPECTED_CLOSURE.provenance.vite.sha256 !==
			anchoredVite?.moduleGraphSha256 ||
		EXPECTED_CLOSURE.provenance.next.artifact !== anchoredNext?.nft ||
		EXPECTED_CLOSURE.provenance.next.sha256 !== anchoredNext?.nftSha256 ||
		EXPECTED_CLOSURE.provenance.next.buildId !== anchoredNext?.observedBuildId
	) {
		throw new Error(
			"C6 closure provenance does not match the independent artifact anchor",
		);
	}
	if (
		JSON.stringify(EXPECTED_CLOSURE.requiredRoots) !==
		JSON.stringify(REQUIRED_ROOTS)
	) {
		throw new Error(
			"C6 expected closure required roots do not match the checker contract",
		);
	}
	for (const host of Object.keys(HOST_ENTRIES)) {
		const expectedHost = EXPECTED_CLOSURE.hosts?.[host];
		if (!expectedHost || !Array.isArray(expectedHost.additional)) {
			throw new Error(`C6 expected closure is missing Host ${host}`);
		}
		const expectedEntries = [HOST_ENTRIES[host], SHARED_SESSION_ENTRY];
		if (
			JSON.stringify(expectedHost.entries) !== JSON.stringify(expectedEntries)
		) {
			throw new Error(`C6 expected closure entries drifted for Host ${host}`);
		}
	}
}

function expectedClosureForHost(host) {
	const expectedHost = EXPECTED_CLOSURE.hosts[host];
	return [
		...new Set([
			...EXPECTED_CLOSURE.common,
			...expectedHost.additional,
			...expectedHost.entries,
		]),
	].sort();
}

function expectedSourceClosure() {
	return [
		...new Set([
			...EXPECTED_CLOSURE.common,
			...Object.values(EXPECTED_CLOSURE.hosts).flatMap((host) => [
				...host.additional,
				...host.entries.filter((entry) => entry.startsWith(SOURCE_ROOT)),
			]),
		]),
	].sort();
}

function closureRoot({ moduleId }) {
	const prefix = `${SOURCE_ROOT}/`;
	if (!moduleId.startsWith(prefix)) return "exact-entries";
	const relative = moduleId.slice(prefix.length);
	return (
		REQUIRED_ROOTS.find(
			(root) => relative === root || relative.startsWith(`${root}/`),
		) ?? "exact-entries"
	);
}

function formatMissingClosure(missing) {
	const grouped = new Map();
	for (const moduleId of missing) {
		const root = closureRoot({ moduleId });
		const values = grouped.get(root) ?? [];
		values.push(moduleId);
		grouped.set(root, values);
	}
	return [...grouped.entries()]
		.map(
			([root, moduleIds]) =>
				`${root} (${moduleIds.length}): ${moduleIds.slice(0, 4).join(", ")}${moduleIds.length > 4 ? ", ..." : ""}`,
		)
		.join("; ");
}

function sourceFileFor({ path, text }) {
	const scriptKind = path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	return ts.createSourceFile(
		path,
		text,
		ts.ScriptTarget.Latest,
		true,
		scriptKind,
	);
}

function ancestor(node, predicate) {
	let current = node.parent;
	while (current) {
		if (predicate(current)) return current;
		current = current.parent;
	}
	return null;
}

function containsIdentifier({ node, name }) {
	let found = false;
	function visit(current) {
		if (found) return;
		if (ts.isIdentifier(current) && current.text === name) {
			found = true;
			return;
		}
		ts.forEachChild(current, visit);
	}
	visit(node);
	return found;
}

function isIdentifierValue({ node, name }) {
	let current = node;
	while (
		ts.isParenthesizedExpression(current) ||
		ts.isAsExpression(current) ||
		ts.isTypeAssertionExpression(current) ||
		ts.isNonNullExpression(current) ||
		ts.isSatisfiesExpression(current)
	) {
		current = current.expression;
	}
	return ts.isIdentifier(current) && current.text === name;
}

function calleeName(expression) {
	if (ts.isIdentifier(expression)) return expression.text;
	if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
	return "";
}

function unwrapExpression(node) {
	let current = node;
	while (
		ts.isParenthesizedExpression(current) ||
		ts.isAsExpression(current) ||
		ts.isTypeAssertionExpression(current) ||
		ts.isNonNullExpression(current) ||
		ts.isSatisfiesExpression(current)
	) {
		current = current.expression;
	}
	return current;
}

const GLOBAL_PROPERTY_TOKENS = new Map([
	["setTimeout", "directTimer"],
	["setInterval", "directTimer"],
	["requestAnimationFrame", "directTimer"],
	["Worker", "workerConstructor"],
	["AudioContext", "audioConstructor"],
	["webkitAudioContext", "audioConstructor"],
	["OfflineAudioContext", "offlineConstructor"],
	["URL", "urlObject"],
]);

const RESOURCE_METHOD_KINDS = new Map([
	["setTimeout", "timer"],
	["setInterval", "timer"],
	["requestAnimationFrame", "timer"],
	["createWorker", "worker"],
	["createAudioContext", "audioContext"],
	["createObjectUrl", "objectUrl"],
	["trackGpuResource", "gpuResource"],
]);

function emptyFlowValue() {
	return {
		tokens: new Set(),
		handles: new Set(),
		functions: new Set(),
		objects: new Set(),
		arrays: new Set(),
	};
}

function mergeFlowValues(...values) {
	const merged = emptyFlowValue();
	for (const value of values) {
		for (const token of value.tokens) merged.tokens.add(token);
		for (const kind of value.handles) merged.handles.add(kind);
		for (const fn of value.functions) merged.functions.add(fn);
		for (const object of value.objects) merged.objects.add(object);
		for (const array of value.arrays) merged.arrays.add(array);
	}
	return merged;
}

function flowToken(token) {
	const value = emptyFlowValue();
	value.tokens.add(token);
	return value;
}

function flowFunction(fn) {
	const value = emptyFlowValue();
	value.functions.add(fn);
	return value;
}

function staticPropertyName(node) {
	if (!node) return null;
	if (
		ts.isIdentifier(node) ||
		ts.isStringLiteral(node) ||
		ts.isNumericLiteral(node) ||
		ts.isNoSubstitutionTemplateLiteral(node)
	) {
		return node.text;
	}
	if (ts.isComputedPropertyName(node)) {
		return staticPropertyName(node.expression);
	}
	return null;
}

function createsLexicalScope(node) {
	return (
		ts.isSourceFile(node) ||
		ts.isFunctionLike(node) ||
		ts.isBlock(node) ||
		ts.isCaseBlock(node) ||
		ts.isCatchClause(node) ||
		ts.isForStatement(node) ||
		ts.isForInStatement(node) ||
		ts.isForOfStatement(node) ||
		ts.isModuleBlock(node)
	);
}

/**
 * A deliberately local value-flow resolver. It follows lexical bindings,
 * aliases, destructuring, computed literal properties, simple assignments and
 * wrapper returns without pretending to be a whole-program type checker.
 */
function createValueFlow(sourceFile) {
	const scopeForNode = new Map();
	let rootScope = null;

	function assignScopes(node, parentScope) {
		let scope = parentScope;
		if (createsLexicalScope(node)) {
			scope = { node, parent: parentScope, bindings: new Map() };
			if (!rootScope) rootScope = scope;
		}
		scopeForNode.set(node, scope);
		ts.forEachChild(node, (child) => assignScopes(child, scope));
	}
	assignScopes(sourceFile, null);

	function addBinding(scope, binding) {
		if (!scope) return;
		const values = scope.bindings.get(binding.name) ?? [];
		values.push(binding);
		values.sort((left, right) => left.position - right.position);
		scope.bindings.set(binding.name, values);
	}

	function bindingPathProperty(element) {
		return staticPropertyName(element.propertyName ?? element.name);
	}

	function addBindingPattern({ name, scope, root, path = [] }) {
		if (ts.isIdentifier(name)) {
			addBinding(scope, {
				name: name.text,
				nameNode: name,
				position: name.getStart(sourceFile),
				root,
				path,
			});
			return;
		}
		if (ts.isObjectBindingPattern(name)) {
			for (const element of name.elements) {
				if (element.dotDotDotToken) continue;
				const property = bindingPathProperty(element);
				if (property === null) continue;
				addBindingPattern({
					name: element.name,
					scope,
					root,
					path: [...path, { type: "property", value: property }],
				});
			}
			return;
		}
		for (const [index, element] of name.elements.entries()) {
			if (!element || ts.isOmittedExpression(element)) continue;
			addBindingPattern({
				name: element.name,
				scope,
				root,
				path: [...path, { type: "index", value: index }],
			});
		}
	}

	function nearestFunctionOrSourceScope(scope) {
		let current = scope;
		while (
			current &&
			!ts.isSourceFile(current.node) &&
			!ts.isFunctionLike(current.node)
		) {
			current = current.parent;
		}
		return current;
	}

	function collectBindings(node) {
		if (ts.isVariableDeclaration(node)) {
			const declarationList = ts.isVariableDeclarationList(node.parent)
				? node.parent
				: null;
			const blockScoped = Boolean(
				declarationList &&
				(declarationList.flags & ts.NodeFlags.BlockScoped) !== 0,
			);
			const localScope = scopeForNode.get(node);
			const scope = blockScoped
				? localScope
				: nearestFunctionOrSourceScope(localScope);
			addBindingPattern({
				name: node.name,
				scope,
				root: { kind: "variable", declaration: node },
			});
		}
		if (ts.isParameter(node)) {
			addBindingPattern({
				name: node.name,
				scope: scopeForNode.get(node),
				root: { kind: "parameter", declaration: node },
			});
		}
		if (ts.isFunctionDeclaration(node) && node.name) {
			addBinding(scopeForNode.get(node.parent), {
				name: node.name.text,
				nameNode: node.name,
				position: node.name.getStart(sourceFile),
				root: { kind: "function", declaration: node },
				path: [],
			});
		}
		if (ts.isFunctionExpression(node) && node.name) {
			addBinding(scopeForNode.get(node), {
				name: node.name.text,
				nameNode: node.name,
				position: node.name.getStart(sourceFile),
				root: { kind: "function", declaration: node },
				path: [],
			});
		}
		if (ts.isClassDeclaration(node) && node.name) {
			addBinding(scopeForNode.get(node.parent), {
				name: node.name.text,
				nameNode: node.name,
				position: node.name.getStart(sourceFile),
				root: { kind: "unknown", declaration: node },
				path: [],
			});
		}
		if (ts.isImportClause(node)) {
			if (node.name) {
				addBinding(rootScope, {
					name: node.name.text,
					nameNode: node.name,
					position: node.name.getStart(sourceFile),
					root: { kind: "unknown", declaration: node },
					path: [],
				});
			}
		}
		if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
			addBinding(rootScope, {
				name: node.name.text,
				nameNode: node.name,
				position: node.name.getStart(sourceFile),
				root: { kind: "unknown", declaration: node },
				path: [],
			});
		}
		ts.forEachChild(node, collectBindings);
	}
	collectBindings(sourceFile);

	function bindingAt(identifier) {
		const usePosition = identifier.getStart(sourceFile);
		let scope = scopeForNode.get(identifier);
		while (scope) {
			const bindings = scope.bindings.get(identifier.text);
			if (bindings?.length) {
				const available = bindings.filter(
					(binding) =>
						binding.root.kind === "function" ||
						binding.root.kind === "parameter" ||
						binding.root.kind === "unknown" ||
						binding.position <= usePosition,
				);
				return available.at(-1) ?? { shadowed: true };
			}
			scope = scope.parent;
		}
		return null;
	}

	const assignments = new Map();
	function collectAssignments(node) {
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			ts.isIdentifier(node.left)
		) {
			const binding = bindingAt(node.left);
			if (binding && !binding.shadowed) {
				const values = assignments.get(binding) ?? [];
				values.push(node.right);
				assignments.set(binding, values);
			}
		}
		ts.forEachChild(node, collectAssignments);
	}
	collectAssignments(sourceFile);

	const functionReturnCache = new Map();

	function propertyValueFromFlow({
		receiverValue,
		property,
		activeBindings,
		activeFunctions,
	}) {
		const values = [];
		if (receiverValue.tokens.has("globalObject")) {
			const token = GLOBAL_PROPERTY_TOKENS.get(property);
			if (token) values.push(flowToken(token));
		}
		if (
			receiverValue.tokens.has("urlObject") &&
			property === "createObjectURL"
		) {
			values.push(flowToken("objectUrlFunction"));
		}
		for (const object of receiverValue.objects) {
			for (const member of object.properties) {
				const memberName = staticPropertyName(member.name);
				if (memberName !== property) continue;
				if (ts.isPropertyAssignment(member)) {
					values.push(
						valueForExpression(member.initializer, {
							activeBindings,
							activeFunctions,
						}),
					);
				}
				if (ts.isShorthandPropertyAssignment(member)) {
					values.push(
						valueForExpression(member.name, {
							activeBindings,
							activeFunctions,
						}),
					);
				}
				if (ts.isMethodDeclaration(member)) values.push(flowFunction(member));
			}
		}
		if (
			!receiverValue.tokens.has("globalObject") &&
			!receiverValue.tokens.has("urlObject")
		) {
			const kind = RESOURCE_METHOD_KINDS.get(property);
			if (kind) values.push(flowToken(`resourceMethod:${kind}`));
		}
		return mergeFlowValues(...values);
	}

	function propertyValue({
		receiver,
		property,
		activeBindings,
		activeFunctions,
	}) {
		return propertyValueFromFlow({
			receiverValue: valueForExpression(receiver, {
				activeBindings,
				activeFunctions,
			}),
			property,
			activeBindings,
			activeFunctions,
		});
	}

	function valueAtPath(expression, path, state) {
		let value = valueForExpression(expression, state);
		for (const segment of path) {
			if (segment.type === "index") {
				const indexedValues = [];
				for (const array of value.arrays) {
					const element = array.elements[segment.value];
					if (element) indexedValues.push(valueForExpression(element, state));
				}
				value = mergeFlowValues(...indexedValues);
				continue;
			}
			value = propertyValueFromFlow({
				receiverValue: value,
				property: segment.value,
				activeBindings: state.activeBindings,
				activeFunctions: state.activeFunctions,
			});
		}
		return value;
	}

	function valueForBinding(binding, state) {
		if (!binding || binding.shadowed) return emptyFlowValue();
		if (state.activeBindings.has(binding)) return emptyFlowValue();
		const activeBindings = new Set(state.activeBindings);
		activeBindings.add(binding);
		const nextState = { ...state, activeBindings };
		if (binding.root.kind === "function") {
			return flowFunction(binding.root.declaration);
		}
		if (binding.root.kind !== "variable") return emptyFlowValue();
		const initializer = binding.root.declaration.initializer;
		const values = [];
		if (initializer) {
			values.push(valueAtPath(initializer, binding.path, nextState));
		}
		for (const assignment of assignments.get(binding) ?? []) {
			values.push(valueForExpression(assignment, nextState));
		}
		return mergeFlowValues(...values);
	}

	function returnedValueForFunction(fn, state) {
		if (state.activeFunctions.has(fn)) return emptyFlowValue();
		const cached = functionReturnCache.get(fn);
		if (cached) return cached;
		const activeFunctions = new Set(state.activeFunctions);
		activeFunctions.add(fn);
		const nextState = { ...state, activeFunctions };
		const values = [];
		if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) {
			values.push(valueForExpression(fn.body, nextState));
		} else if (fn.body) {
			function visit(node) {
				if (node !== fn.body && ts.isFunctionLike(node)) return;
				if (ts.isReturnStatement(node) && node.expression) {
					values.push(valueForExpression(node.expression, nextState));
					return;
				}
				ts.forEachChild(node, visit);
			}
			visit(fn.body);
		}
		const value = mergeFlowValues(...values);
		functionReturnCache.set(fn, value);
		return value;
	}

	function valueForExpression(
		node,
		{ activeBindings = new Set(), activeFunctions = new Set() } = {},
	) {
		if (!node || typeof node.kind !== "number") return emptyFlowValue();
		const current = unwrapExpression(node);
		const state = { activeBindings, activeFunctions };
		if (ts.isIdentifier(current)) {
			const binding = bindingAt(current);
			if (binding) return valueForBinding(binding, state);
			if (current.text === "globalThis" || current.text === "window") {
				return flowToken("globalObject");
			}
			const token = GLOBAL_PROPERTY_TOKENS.get(current.text);
			return token ? flowToken(token) : emptyFlowValue();
		}
		if (ts.isPropertyAccessExpression(current)) {
			return propertyValue({
				receiver: current.expression,
				property: current.name.text,
				activeBindings,
				activeFunctions,
			});
		}
		if (ts.isElementAccessExpression(current)) {
			const property = staticPropertyName(current.argumentExpression);
			return property === null
				? emptyFlowValue()
				: propertyValue({
						receiver: current.expression,
						property,
						activeBindings,
						activeFunctions,
					});
		}
		if (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
			return flowFunction(current);
		}
		if (ts.isObjectLiteralExpression(current)) {
			const value = emptyFlowValue();
			value.objects.add(current);
			for (const member of current.properties) {
				if (ts.isPropertyAssignment(member)) {
					const memberValue = valueForExpression(member.initializer, state);
					for (const kind of memberValue.handles) value.handles.add(kind);
				}
				if (ts.isShorthandPropertyAssignment(member)) {
					const memberValue = valueForExpression(member.name, state);
					for (const kind of memberValue.handles) value.handles.add(kind);
				}
			}
			return value;
		}
		if (ts.isArrayLiteralExpression(current)) {
			const value = emptyFlowValue();
			value.arrays.add(current);
			for (const element of current.elements) {
				const elementValue = valueForExpression(element, state);
				for (const kind of elementValue.handles) value.handles.add(kind);
			}
			return value;
		}
		if (ts.isCallExpression(current)) {
			const callee = valueForExpression(current.expression, state);
			const values = [];
			for (const token of callee.tokens) {
				if (!token.startsWith("resourceMethod:")) continue;
				const value = emptyFlowValue();
				value.handles.add(token.slice("resourceMethod:".length));
				values.push(value);
			}
			for (const fn of callee.functions) {
				values.push(returnedValueForFunction(fn, state));
			}
			return mergeFlowValues(...values);
		}
		if (ts.isConditionalExpression(current)) {
			return mergeFlowValues(
				valueForExpression(current.whenTrue, state),
				valueForExpression(current.whenFalse, state),
			);
		}
		if (
			ts.isBinaryExpression(current) &&
			[
				ts.SyntaxKind.BarBarToken,
				ts.SyntaxKind.QuestionQuestionToken,
				ts.SyntaxKind.CommaToken,
				ts.SyntaxKind.EqualsToken,
			].includes(current.operatorToken.kind)
		) {
			return mergeFlowValues(
				valueForExpression(current.left, state),
				valueForExpression(current.right, state),
			);
		}
		if (ts.isAwaitExpression(current)) {
			return valueForExpression(current.expression, state);
		}
		return emptyFlowValue();
	}

	function escapingResourceKinds(fn) {
		const kinds = new Set();
		const returnedExpressions = [];
		if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) {
			returnedExpressions.push(fn.body);
		} else if (fn.body) {
			function collectReturns(node) {
				if (node !== fn.body && ts.isFunctionLike(node)) return;
				if (ts.isReturnStatement(node) && node.expression) {
					returnedExpressions.push(node.expression);
					return;
				}
				ts.forEachChild(node, collectReturns);
			}
			collectReturns(fn.body);
		}
		for (const expression of returnedExpressions) {
			const value = valueForExpression(expression);
			for (const kind of value.handles) kinds.add(kind);
			function collectNested(node) {
				if (node !== expression && ts.isFunctionLike(node)) return;
				if (ts.isCallExpression(node)) {
					for (const kind of valueForExpression(node).handles) kinds.add(kind);
				}
				ts.forEachChild(node, collectNested);
			}
			collectNested(expression);
		}
		return kinds;
	}

	return { valueForExpression, escapingResourceKinds };
}

function expressionStoresIdentifier({ node, name }) {
	const current = unwrapExpression(node);
	if (ts.isIdentifier(current)) return current.text === name;
	if (ts.isArrayLiteralExpression(current)) {
		return current.elements.some((element) =>
			expressionStoresIdentifier({ node: element, name }),
		);
	}
	if (ts.isObjectLiteralExpression(current)) {
		return current.properties.some((property) => {
			if (ts.isShorthandPropertyAssignment(property)) {
				return property.name.text === name;
			}
			if (ts.isPropertyAssignment(property)) {
				return expressionStoresIdentifier({ node: property.initializer, name });
			}
			if (ts.isSpreadAssignment(property)) {
				return expressionStoresIdentifier({ node: property.expression, name });
			}
			return false;
		});
	}
	if (ts.isConditionalExpression(current)) {
		return (
			expressionStoresIdentifier({ node: current.whenTrue, name }) ||
			expressionStoresIdentifier({ node: current.whenFalse, name })
		);
	}
	return false;
}

function nodeIsWithin({ node, container }) {
	return node.pos >= container.pos && node.end <= container.end;
}

function finallyDisposesInput({ tryStatement, inputName }) {
	if (!tryStatement.finallyBlock) return false;
	let disposes = false;
	function visit(node) {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			ts.isIdentifier(node.expression.expression) &&
			node.expression.expression.text === inputName &&
			node.expression.name.text === "dispose"
		) {
			disposes = true;
			return;
		}
		ts.forEachChild(node, visit);
	}
	visit(tryStatement.finallyBlock);
	return disposes;
}

function scanDirectAcquisitions({ path, sourceFile, flow }) {
	const hits = [];
	const seen = new Set();
	const lines = sourceFile.text.split(/\r?\n/);

	function add(node, rule, reason) {
		const line =
			sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
			1;
		const sourceLine = lines[line - 1] ?? "";
		if (exemptionFor({ path, rule, line: sourceLine })) return;
		const key = `${rule}:${node.getStart(sourceFile)}`;
		if (seen.has(key)) return;
		seen.add(key);
		hits.push({ rule, path, line, text: reason });
	}

	function visit(node) {
		if (ts.isCallExpression(node)) {
			const callee = flow.valueForExpression(node.expression);
			if (callee.tokens.has("directTimer")) {
				add(
					node,
					"no-direct-timer",
					"direct timer acquisition through value flow",
				);
			}
			if (callee.tokens.has("objectUrlFunction")) {
				add(
					node,
					"no-direct-object-url",
					"direct object URL acquisition through value flow",
				);
			}
		}
		if (ts.isNewExpression(node)) {
			const constructor = flow.valueForExpression(node.expression);
			if (constructor.tokens.has("workerConstructor")) {
				add(
					node,
					"no-direct-worker",
					"direct Worker construction through value flow",
				);
			}
			if (constructor.tokens.has("audioConstructor")) {
				add(
					node,
					"no-direct-audio",
					"direct AudioContext construction through value flow",
				);
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	return hits;
}

function scanOfflineContexts({ path, sourceFile, flow }) {
	const hits = [];
	const seen = new Set();
	function add(node, reason) {
		const line =
			sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
			1;
		const key = `${line}:${reason}`;
		if (seen.has(key)) return;
		seen.add(key);
		hits.push({
			rule: "no-offline-escape",
			path,
			line,
			text: reason,
		});
	}

	function inspect(node) {
		if (
			!ts.isNewExpression(node) ||
			!flow.valueForExpression(node.expression).tokens.has("offlineConstructor")
		) {
			ts.forEachChild(node, inspect);
			return;
		}
		const constructor = unwrapExpression(node.expression);
		if (
			!ts.isIdentifier(constructor) ||
			constructor.text !== "OfflineAudioContext"
		) {
			add(
				node,
				"OfflineAudioContext aliases and destructuring are not a reviewed bounded constructor form",
			);
		}

		const declaration = ts.isVariableDeclaration(node.parent)
			? node.parent
			: null;
		const owner = ancestor(node, ts.isFunctionLike);
		if (
			!declaration ||
			!ts.isIdentifier(declaration.name) ||
			!ts.isVariableDeclarationList(declaration.parent) ||
			(declaration.parent.flags & ts.NodeFlags.Const) === 0
		) {
			add(node, "OfflineAudioContext must be held by one local const binding");
		}
		if (!owner?.body) {
			add(node, "OfflineAudioContext escaped into module or lifecycle state");
			return;
		}
		if (!declaration || !ts.isIdentifier(declaration.name)) return;

		const contextName = declaration.name.text;
		const renderCalls = [];
		const inputNames = new Set();
		function walk(current) {
			if (
				ts.isVariableDeclaration(current) &&
				ts.isIdentifier(current.name) &&
				current.initializer &&
				ts.isNewExpression(current.initializer) &&
				calleeName(current.initializer.expression) === "Input"
			) {
				inputNames.add(current.name.text);
			}

			if (
				ts.isCallExpression(current) &&
				ts.isPropertyAccessExpression(current.expression) &&
				ts.isIdentifier(current.expression.expression) &&
				current.expression.expression.text === contextName &&
				current.expression.name.text === "startRendering"
			) {
				renderCalls.push(current);
				if (!ts.isAwaitExpression(current.parent)) {
					add(current, "OfflineAudioContext.startRendering() must be awaited");
				}
			}

			if (
				ts.isIdentifier(current) &&
				current.text === contextName &&
				current !== declaration.name
			) {
				const nearestOwner = ancestor(current, ts.isFunctionLike);
				if (nearestOwner && nearestOwner !== owner) {
					add(current, "OfflineAudioContext is captured by a nested lifecycle");
				}
			}

			if (
				ts.isReturnStatement(current) &&
				current.expression &&
				containsIdentifier({ node: current.expression, name: contextName })
			) {
				const expression = current.expression;
				const allowedTerminalReturn =
					ts.isAwaitExpression(expression) &&
					ts.isCallExpression(expression.expression) &&
					ts.isPropertyAccessExpression(expression.expression.expression) &&
					ts.isIdentifier(expression.expression.expression.expression) &&
					expression.expression.expression.expression.text === contextName &&
					expression.expression.expression.name.text === "startRendering";
				if (!allowedTerminalReturn) {
					add(current, "OfflineAudioContext value escapes through return");
				}
			}

			if (
				ts.isVariableDeclaration(current) &&
				current !== declaration &&
				current.initializer &&
				expressionStoresIdentifier({
					node: current.initializer,
					name: contextName,
				})
			) {
				add(current, "OfflineAudioContext value is stored in another binding");
			}

			if (
				ts.isBinaryExpression(current) &&
				current.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
				expressionStoresIdentifier({
					node: current.right,
					name: contextName,
				})
			) {
				add(current, "OfflineAudioContext value escapes through assignment");
			}

			if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
				const allowedCallees =
					OFFLINE_CONTEXT_ARGUMENT_ALLOWANCES.get(path) ?? new Set();
				for (const argument of current.arguments ?? []) {
					if (!containsIdentifier({ node: argument, name: contextName }))
						continue;
					const safeDestination =
						ts.isPropertyAccessExpression(argument) &&
						ts.isIdentifier(argument.expression) &&
						argument.expression.text === contextName &&
						argument.name.text === "destination";
					if (
						!safeDestination &&
						!allowedCallees.has(calleeName(current.expression))
					) {
						add(
							argument,
							`OfflineAudioContext is passed to unreviewed callee ${calleeName(current.expression) || "<anonymous>"}`,
						);
					}
				}
			}

			ts.forEachChild(current, walk);
		}
		walk(owner.body);

		if (renderCalls.length !== 1) {
			add(
				node,
				`OfflineAudioContext must have exactly one awaited terminal render (found ${renderCalls.length})`,
			);
		}

		for (const inputName of inputNames) {
			let disposedInFinally = false;
			function findDisposal(current) {
				if (
					ts.isTryStatement(current) &&
					renderCalls.every((renderCall) =>
						nodeIsWithin({ node: renderCall, container: current.tryBlock }),
					) &&
					finallyDisposesInput({ tryStatement: current, inputName })
				) {
					disposedInFinally = true;
				}
				ts.forEachChild(current, findDisposal);
			}
			findDisposal(owner.body);
			if (!disposedInFinally) {
				add(
					node,
					`OfflineAudioContext media input ${inputName} is not disposed in finally`,
				);
			}
		}

		ts.forEachChild(node, inspect);
	}
	inspect(sourceFile);
	return hits;
}

function functionLikeName(node) {
	if (node.name) return staticPropertyName(node.name);
	if (ts.isVariableDeclaration(node.parent)) {
		return staticPropertyName(node.parent.name);
	}
	if (ts.isPropertyAssignment(node.parent)) {
		return staticPropertyName(node.parent.name);
	}
	return null;
}

function scanStructuralMediators({ path, sourceFile, flow }) {
	if (STRUCTURAL_MEDIATOR_EXEMPTIONS.has(path)) return [];
	const hits = [];
	const seen = new Set();
	function add(node, kinds) {
		const line =
			sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
			1;
		const key = node.getStart(sourceFile);
		if (seen.has(key)) return;
		seen.add(key);
		hits.push({
			rule: "no-second-acquisition-mediator",
			path,
			line,
			text: `structure exposes acquisition wrappers for ${[...kinds].sort().join(", ")}`,
		});
	}
	function inspect(node) {
		if (ts.isFunctionLike(node) && node.body) {
			const kinds = flow.escapingResourceKinds(node);
			const name = functionLikeName(node);
			const exempt = name
				? STRUCTURAL_WRAPPER_EXEMPTIONS.get(path)?.has(name)
				: false;
			if (kinds.size >= 1 && !exempt) add(node, kinds);
		}
		ts.forEachChild(node, inspect);
	}
	inspect(sourceFile);
	return hits;
}

function trackedFiles() {
	return execFileSync(
		"git",
		[
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
			...SCAN_ROOTS,
		],
		{ cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	)
		.split("\0")
		.filter(Boolean)
		.map(normalize)
		.filter((path) => EXTENSIONS.test(path))
		.filter((path) => !path.includes("/__tests__/"))
		.filter((path) => !path.includes("/fixtures/"));
}

function exemptionFor({ path, rule, line }) {
	return (CONSTRUCT_EXEMPTIONS.get(path) ?? []).find(
		(entry) => entry.rule === rule && line.includes(entry.match),
	);
}

function scan(path, text) {
	if (path === REGISTRY) return [];
	const hits = [];
	for (const [index, line] of text.split(/\r?\n/).entries()) {
		if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;
		if (
			/^\s*(?:setTimeout|setInterval|requestAnimationFrame)\s*\(\s*\w+\s*\??\s*:/.test(
				line,
			)
		)
			continue;
		for (const rule of RULES) {
			if (!rule.test(line)) continue;
			if (exemptionFor({ path, rule: rule.id, line })) continue;
			hits.push({ rule: rule.id, path, line: index + 1, text: line.trim() });
		}
	}
	const sourceFile = sourceFileFor({ path, text });
	const flow = createValueFlow(sourceFile);
	return [
		...hits,
		...scanDirectAcquisitions({ path, sourceFile, flow }),
		...scanOfflineContexts({ path, sourceFile, flow }),
		...scanStructuralMediators({ path, sourceFile, flow }),
	];
}

function rootInventory(files) {
	return REQUIRED_ROOTS.map((root) => ({
		root,
		files: files.filter((path) => path.startsWith(`${SOURCE_ROOT}/${root}/`))
			.length,
	}));
}

function emittedRootInventory(moduleIds) {
	return REQUIRED_ROOTS.map((root) => ({
		root,
		files: moduleIds.filter((moduleId) =>
			moduleId.startsWith(`${SOURCE_ROOT}/${root}/`),
		).length,
	}));
}

function missingEntries(moduleIds, entries) {
	return entries.filter((entry) => !moduleIds.includes(entry));
}

const FIXTURES = [
	{
		rule: "no-direct-timer",
		path: "packages/editor-classic/src/editor/fixture/direct-timer.ts",
		text: "setTimeout(() => {}, 1);",
	},
	{
		rule: "no-direct-worker",
		path: "packages/editor-classic/src/editor/fixture/direct-worker.ts",
		text: "new Worker(url);",
	},
	{
		rule: "no-direct-audio",
		path: "packages/editor-classic/src/editor/fixture/direct-audio.ts",
		text: "new AudioContext();",
	},
	{
		rule: "no-direct-object-url",
		path: "packages/editor-classic/src/editor/fixture/direct-object-url.ts",
		text: "URL.createObjectURL(blob);",
	},
	{
		rule: "no-offline-escape",
		path: "packages/editor-classic/src/editor/fixture/offline-escape.ts",
		text: "new OfflineAudioContext(1, 1, 44100);",
	},
	{
		rule: "no-unkeyed-compositor",
		path: "packages/editor-classic/src/services/renderer/fixture/default-compositor.ts",
		text: "renderFrame(frame);",
	},
	{
		rule: "no-second-acquisition-mediator",
		path: "packages/editor-classic/src/editor/session/fixture/second-resource-mediator.ts",
		text: "return { spawn: () => host.createWorker({ request }), open: () => host.createAudioContext({}) };",
	},
];

const POSITIVE_CONTROLS = [
	{
		rule: "no-direct-timer",
		path: "packages/editor-classic/src/editor/fixture/mediated-timer.ts",
		text: "resources.setTimeout({ handler: () => {}, ms: 1 });",
	},
	{
		rule: "no-direct-worker",
		path: "packages/editor-classic/src/editor/fixture/mediated-worker.ts",
		text: "resources.createWorker({ request });",
	},
	{
		rule: "no-direct-audio",
		path: "packages/editor-classic/src/editor/fixture/mediated-audio.ts",
		text: "resources.createAudioContext({});",
	},
	{
		rule: "no-direct-object-url",
		path: "packages/editor-classic/src/editor/fixture/mediated-object-url.ts",
		text: "resources.createObjectUrl({ blob });",
	},
	{
		rule: "no-offline-escape",
		path: "packages/editor-classic/src/media/fixture/bounded-offline.ts",
		text: "export async function render() { const context = new OfflineAudioContext(1, 1, 44100); return await context.startRendering(); }",
	},
	{
		rule: "no-unkeyed-compositor",
		path: "packages/editor-classic/src/services/renderer/fixture/keyed-compositor.ts",
		text: "renderFrameForHandle(handle, frame);",
	},
	{
		rule: "no-second-acquisition-mediator",
		path: SHARED_SESSION_ENTRY,
		text: "const resources = createSessionResources({ host });",
	},
];

const OFFLINE_SEMANTIC_CONTROLS = [
	{
		label: "offline constructor-alias escape control",
		text: `const Ctx = OfflineAudioContext;
			export const live = new Ctx(1, 1, 44100);`,
	},
	{
		label: "offline container escape control",
		text: `export async function render() {
			const context = new OfflineAudioContext(1, 1, 44100);
			const escaped = { context };
			consume(escaped);
			return await context.startRendering();
		}`,
	},
	{
		label: "offline unrelated-finally control",
		text: `export async function render() {
			const input = new Input({ source });
			try { consume(input); } finally { input.dispose(); }
			const context = new OfflineAudioContext(1, 1, 44100);
			return await context.startRendering();
		}`,
	},
	{
		label: "offline storage escape control",
		text: `export async function render() {
			const context = new OfflineAudioContext(1, 1, 44100);
			owner.context = context;
			return await context.startRendering();
		}`,
	},
	{
		label: "offline exported escape control",
		text: `export const context = new OfflineAudioContext(1, 1, 44100);`,
	},
	{
		label: "offline return escape control",
		text: `export async function render() {
			const context = new OfflineAudioContext(1, 1, 44100);
			return context;
		}`,
	},
	{
		label: "offline missing-awaited-render control",
		text: `export async function render() {
			const context = new OfflineAudioContext(1, 1, 44100);
			return context.startRendering();
		}`,
	},
	{
		label: "offline lifecycle escape control",
		text: `export async function render() {
			const context = new OfflineAudioContext(1, 1, 44100);
			queueMicrotask(() => context.startRendering());
			return await context.startRendering();
		}`,
	},
];

const BOUNDED_OFFLINE_POSITIVE = {
	label: "bounded offline operation positive control",
	text: `export async function render() {
		const context = new OfflineAudioContext(1, 1, 44100);
		return await context.startRendering();
	}`,
};

const ARBITRARY_MEDIATOR_CONTROL = {
	label: "arbitrarily named acquisition mediator control",
	text: `export function makeBroker(host) {
		return {
			spawn: () => host.createWorker({ request }),
			open: () => host.createAudioContext({}),
		};
	}`,
};

const BLOCK_MEDIATOR_CONTROL = {
	label: "block-bodied acquisition mediator control",
	text: `export function makeBroker(host) {
		return {
			spawn() { const handle = host.createWorker({ request }); return handle; },
			open() { const handle = host.createAudioContext({}); return handle; },
		};
	}`,
};

function validateEmittedInventory({
	name,
	host,
	moduleIds,
	sourceModuleIds,
	entries,
}) {
	const normalized = [
		...new Set(moduleIds.map((moduleId) => normalize(String(moduleId)))),
	];
	const normalizedSource = [
		...new Set(
			(
				sourceModuleIds ??
				normalized.filter(
					(moduleId) =>
						isEditorPackageModule(moduleId) ||
						moduleId.startsWith("apps/web/src/") ||
						moduleId.startsWith("apps/vite-example/src/"),
				)
			).map((moduleId) => normalize(String(moduleId))),
		),
	];
	if (normalized.length === 0) {
		throw new Error(`C6 emitted ${name} graph is empty`);
	}
	const expectedClosure = expectedClosureForHost(host);
	const sourceSet = new Set(normalizedSource);
	const missingClosure = expectedClosure.filter(
		(moduleId) => !sourceSet.has(moduleId),
	);
	if (missingClosure.length > 0) {
		throw new Error(
			`C6 emitted ${name} graph is truncated; omitted attributable closure: ${formatMissingClosure(missingClosure)}`,
		);
	}
	const missing = emittedRootInventory(normalized).filter(
		({ files }) => files === 0,
	);
	if (missing.length) {
		throw new Error(
			`C6 emitted ${name} graph omitted roots: ${missing.map(({ root }) => root).join(", ")}`,
		);
	}
	const missingRequiredEntries = missingEntries(normalized, entries);
	if (missingRequiredEntries.length) {
		throw new Error(
			`C6 emitted ${name} graph omitted exact entries: ${missingRequiredEntries.join(", ")}`,
		);
	}
	return {
		moduleIds: normalized,
		inventory: emittedRootInventory(normalized),
		expectedInventory: emittedRootInventory(expectedClosure),
	};
}

function assertAnchoredValue({ label, actual, expected }) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`C6 anchored ${label} drifted (expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)})`,
		);
	}
}

function verifyAnchoredProvenance() {
	const viteAnchor = EXPECTED_CLOSURE_ANCHOR.artifacts.vite;
	const nextAnchor = EXPECTED_CLOSURE_ANCHOR.artifacts.next;
	const viteGraphPath = resolve(ROOT, viteAnchor.moduleGraph);
	const viteManifestPath = resolve(ROOT, viteAnchor.assetManifest);
	if (!existsSync(viteGraphPath) || !existsSync(viteManifestPath)) {
		throw new Error(
			"C6 anchored Vite provenance artifacts are unavailable; restore the reviewed output before provenance verification",
		);
	}
	assertAnchoredValue({
		label: "Vite module-graph SHA-256",
		actual: sha256File(viteGraphPath),
		expected: viteAnchor.moduleGraphSha256,
	});
	assertAnchoredValue({
		label: "Vite asset-manifest SHA-256",
		actual: sha256File(viteManifestPath),
		expected: viteAnchor.assetManifestSha256,
	});
	const viteGraph = JSON.parse(readFileSync(viteGraphPath, "utf8"));
	const viteModuleIds = Array.isArray(viteGraph.modules)
		? viteGraph.modules.map((moduleId) => normalize(String(moduleId)))
		: [];
	const viteAttributableSourceIds = viteModuleIds.filter(
		(moduleId) =>
			isEditorPackageModule(moduleId) ||
			moduleId.startsWith("apps/vite-example/src/"),
	);
	const viteWebSourceIds = viteAttributableSourceIds.filter((moduleId) =>
		isEditorPackageModule(moduleId),
	);
	assertAnchoredValue({
		label: "Vite module inventory",
		actual: canonicalStringSetDigest(viteModuleIds),
		expected: viteAnchor.moduleIds,
	});
	assertAnchoredValue({
		label: "Vite web-source inventory",
		actual: canonicalStringSetDigest(viteWebSourceIds),
		expected: viteAnchor.webSourceModuleIds,
	});
	assertAnchoredValue({
		label: "Vite attributable-source inventory",
		actual: canonicalStringSetDigest(viteAttributableSourceIds),
		expected: viteAnchor.attributableSourceModuleIds,
	});
	validateEmittedInventory({
		name: "anchored-vite",
		host: "vite",
		moduleIds: viteModuleIds,
		sourceModuleIds: viteAttributableSourceIds,
		entries: [HOST_ENTRIES.vite, SHARED_SESSION_ENTRY],
	});

	const nextDist = resolve(ROOT, nextAnchor.dist);
	if (!existsSync(nextDist)) {
		throw new Error(
			"C6 anchored Next provenance artifact is unavailable; restore the reviewed output before provenance verification",
		);
	}
	const nextInventory = collectNextEditorModuleIds({
		distDir: nextDist,
		repositoryRoot: ROOT,
	});
	if (nextInventory.missingFiles.length || nextInventory.missingMaps.length) {
		throw new Error("C6 anchored Next route has missing files or source maps");
	}
	const actualNftPath = normalize(
		resolve(nextInventory.nftPath).slice(resolve(ROOT).length + 1),
	);
	assertAnchoredValue({
		label: "Next NFT path",
		actual: actualNftPath,
		expected: nextAnchor.nft,
	});
	const nextDigests = collectNextEditorArtifactDigests({
		inventory: nextInventory,
		repositoryRoot: ROOT,
	});
	for (const key of [
		"nftSha256",
		"routePageSha256",
		"routeManifestSha256",
		"routeFiles",
		"sourceMaps",
		"moduleIds",
		"sourceModuleIds",
		"buildIdSha256",
	]) {
		assertAnchoredValue({
			label: `Next ${key}`,
			actual: nextDigests[key],
			expected: nextAnchor[key],
		});
	}
	assertAnchoredValue({
		label: "Next observed BUILD_ID",
		actual: nextInventory.buildId,
		expected: nextAnchor.observedBuildId,
	});
	validateEmittedInventory({
		name: "anchored-next",
		host: "next",
		moduleIds: nextInventory.moduleIds,
		sourceModuleIds: nextInventory.sourceModuleIds,
		entries: [HOST_ENTRIES.next, SHARED_SESSION_ENTRY],
	});
	console.log(
		`PASS anchored closure provenance: Vite ${viteAnchor.moduleIds.count} modules/${viteAnchor.webSourceModuleIds.count} web source IDs; Next ${nextAnchor.routeFiles.count} route files/${nextAnchor.sourceMaps.count} maps/${nextAnchor.moduleIds.count} module IDs/${nextAnchor.sourceModuleIds.count} source IDs`,
	);
	console.log(
		`  closure=${EXPECTED_CLOSURE_ANCHOR.closure.canonicalPayloadSha256}; BUILD_ID is verified provenance metadata and is excluded from the closure payload`,
	);
}

function negativeControl() {
	let ok = true;
	for (const fixture of FIXTURES) {
		const hits = scan(
			fixture.path,
			`export function fixture() { ${fixture.text} }`,
		);
		const caught = hits.some(
			(hit) => hit.rule === fixture.rule && hit.path === fixture.path,
		);
		console.log(
			`  ${caught ? "PASS" : "FAIL"} ${fixture.rule} @ ${fixture.path}: ${fixture.text}`,
		);
		if (!caught) ok = false;
	}
	for (const fixture of POSITIVE_CONTROLS) {
		const hits = scan(fixture.path, fixture.text);
		const caught = hits.some((hit) => hit.rule === fixture.rule);
		const clean = !caught;
		console.log(
			`  ${clean ? "PASS" : "FAIL"} positive ${fixture.rule} @ ${fixture.path}`,
		);
		if (!clean) ok = false;
	}
	for (const control of OFFLINE_SEMANTIC_CONTROLS) {
		const caught = scan(
			"packages/editor-classic/src/media/fixture/offline-semantic-control.ts",
			control.text,
		).some((hit) => hit.rule === "no-offline-escape");
		console.log(`  ${caught ? "PASS" : "FAIL"} ${control.label}`);
		if (!caught) ok = false;
	}
	const boundedOfflineClean = !scan(
		"packages/editor-classic/src/media/fixture/bounded-offline-control.ts",
		BOUNDED_OFFLINE_POSITIVE.text,
	).some((hit) => hit.rule === "no-offline-escape");
	console.log(
		`  ${boundedOfflineClean ? "PASS" : "FAIL"} ${BOUNDED_OFFLINE_POSITIVE.label}`,
	);
	if (!boundedOfflineClean) ok = false;
	const arbitraryMediatorCaught = scan(
		"packages/editor-classic/src/editor/session/fixture/arbitrary-broker.ts",
		ARBITRARY_MEDIATOR_CONTROL.text,
	).some((hit) => hit.rule === "no-second-acquisition-mediator");
	console.log(
		`  ${arbitraryMediatorCaught ? "PASS" : "FAIL"} ${ARBITRARY_MEDIATOR_CONTROL.label}`,
	);
	if (!arbitraryMediatorCaught) ok = false;
	const blockMediatorCaught = scan(
		"packages/editor-classic/src/editor/session/fixture/block-broker.ts",
		BLOCK_MEDIATOR_CONTROL.text,
	).some((hit) => hit.rule === "no-second-acquisition-mediator");
	console.log(
		`  ${blockMediatorCaught ? "PASS" : "FAIL"} ${BLOCK_MEDIATOR_CONTROL.label}`,
	);
	if (!blockMediatorCaught) ok = false;
	const files = trackedFiles();
	for (const root of REQUIRED_ROOTS) {
		const omittedInventory = rootInventory(
			files.filter((path) => !path.startsWith(`${SOURCE_ROOT}/${root}/`)),
		);
		const caught = omittedInventory.some(
			(entry) => entry.root === root && entry.files === 0,
		);
		console.log(
			`  ${caught ? "PASS" : "FAIL"} required-root negative control @ ${SOURCE_ROOT}/${root}`,
		);
		if (!caught) ok = false;
	}
	const truncatedModules = [
		...REQUIRED_ROOTS.map((root) => `${SOURCE_ROOT}/${root}/truncated.ts`),
		HOST_ENTRIES.vite,
		SHARED_SESSION_ENTRY,
	];
	try {
		validateEmittedInventory({
			name: "truncated-fixture",
			host: "vite",
			moduleIds: truncatedModules,
			entries: [HOST_ENTRIES.vite, SHARED_SESSION_ENTRY],
		});
		console.log("  FAIL truncated-but-nonempty emitted graph control");
		ok = false;
	} catch (error) {
		const caught = String(error).includes("truncated");
		console.log(
			`  ${caught ? "PASS" : "FAIL"} truncated-but-nonempty emitted graph control`,
		);
		if (!caught) ok = false;
	}
	const missingRootModules = truncatedModules.filter(
		(moduleId) => !moduleId.startsWith(`${SOURCE_ROOT}/preview/`),
	);
	try {
		validateEmittedInventory({
			name: "missing-root-fixture",
			host: "vite",
			moduleIds: [
				...missingRootModules,
				...Array.from(
					{ length: 80 },
					(_, index) => `apps/web/src/unmandated/fixture-${index}.ts`,
				),
			],
			entries: [HOST_ENTRIES.vite, SHARED_SESSION_ENTRY],
		});
		console.log("  FAIL missing-root emitted graph control");
		ok = false;
	} catch (error) {
		const caught =
			String(error).includes("omitted attributable closure") &&
			String(error).includes("preview");
		console.log(
			`  ${caught ? "PASS" : "FAIL"} missing-root emitted graph control`,
		);
		if (!caught) ok = false;
	}
	const sourceTruncated = new Set(
		REQUIRED_ROOTS.map((root) => `${SOURCE_ROOT}/${root}/only.ts`),
	);
	const sourceTruncatedCaught = expectedSourceClosure().some(
		(moduleId) => !sourceTruncated.has(moduleId),
	);
	console.log(
		`  ${sourceTruncatedCaught ? "PASS" : "FAIL"} truncated source inventory control`,
	);
	if (!sourceTruncatedCaught) ok = false;
	const expectedVite = expectedClosureForHost("vite");
	const omittedExpected = expectedVite.find((moduleId) =>
		moduleId.startsWith(`${SOURCE_ROOT}/components/editor/`),
	);
	const paddedRequiredRootModules = [
		...expectedVite.filter((moduleId) => moduleId !== omittedExpected),
		...REQUIRED_ROOTS.flatMap((root, rootIndex) =>
			Array.from(
				{ length: 8 },
				(_, index) => `${SOURCE_ROOT}/${root}/padding-${rootIndex}-${index}.ts`,
			),
		),
		...Array.from(
			{ length: 80 },
			(_, index) => `${SOURCE_ROOT}/unmandated/padding-${index}.ts`,
		),
	];
	try {
		validateEmittedInventory({
			name: "padded-required-root-fixture",
			host: "vite",
			moduleIds: paddedRequiredRootModules,
			entries: [HOST_ENTRIES.vite, SHARED_SESSION_ENTRY],
		});
		console.log("  FAIL padded required-root closure control");
		ok = false;
	} catch (error) {
		const caught =
			String(error).includes("omitted attributable closure") &&
			String(error).includes("components/editor");
		console.log(
			`  ${caught ? "PASS" : "FAIL"} padded required-root closure control`,
		);
		if (!caught) ok = false;
	}
	if (!ok) process.exit(1);
	console.log("\nC6 session-resource boundary negative controls clean");
}

function checkEmittedGraph() {
	const viteDist = process.env.C6_VITE_DIST;
	const nextDist = process.env.C6_NEXT_DIST;
	const roots = [];
	if (viteDist) roots.push({ name: "vite", path: viteDist });
	if (nextDist) roots.push({ name: "next", path: nextDist });
	if (roots.length === 0) return;
	for (const { name, path } of roots) {
		const absolute = resolve(ROOT, path);
		if (name === "vite") {
			const graphPath = join(absolute, "module-graph.json");
			if (!existsSync(graphPath))
				throw new Error(`C6 emitted ${name} graph is missing: ${path}`);
			const graph = JSON.parse(readFileSync(graphPath, "utf8"));
			const modules = Array.isArray(graph.modules)
				? graph.modules.map((module) => normalize(String(module)))
				: [];
			const checked = validateEmittedInventory({
				name,
				host: name,
				moduleIds: modules,
				sourceModuleIds: modules.filter(
					(moduleId) =>
						isEditorPackageModule(moduleId) ||
						moduleId.startsWith("apps/vite-example/src/"),
				),
				entries: [HOST_ENTRIES.vite, SHARED_SESSION_ENTRY],
			});
			const sourceModules = checked.moduleIds.filter((moduleId) =>
				isEditorPackageModule(moduleId),
			);
			const markerPath = join(absolute, "asset-manifest.json");
			let marker = "<missing>";
			if (existsSync(markerPath)) {
				try {
					const assetManifest = JSON.parse(readFileSync(markerPath, "utf8"));
					marker = String(
						assetManifest?.build?.marker ??
							assetManifest?.marker ??
							"<missing>",
					);
				} catch {
					marker = "<invalid>";
				}
			}
			if (marker === "<missing>" || marker === "<invalid>" || marker === "") {
				throw new Error(`C6 emitted vite build marker is missing: ${absolute}`);
			}
			console.log(
				`  PASS emitted ${name} graph: ${modules.length} modules (${sourceModules.length} web source IDs); marker=${marker}; exact entries=${[HOST_ENTRIES.vite, SHARED_SESSION_ENTRY].join(", ")}; attributable closure complete`,
			);
			for (const expected of checked.expectedInventory) {
				const actual = checked.inventory.find(
					(entry) => entry.root === expected.root,
				)?.files;
				console.log(
					`    ${expected.root}=expected:${expected.files}/actual:${actual ?? 0}`,
				);
			}
			continue;
		}

		const nextInventory = collectNextEditorModuleIds({
			distDir: absolute,
			repositoryRoot: ROOT,
		});
		if (nextInventory.missingFiles.length) {
			throw new Error(
				`C6 emitted next route references missing files: ${nextInventory.missingFiles
					.slice(0, 5)
					.join(", ")}`,
			);
		}
		if (nextInventory.missingMaps.length) {
			throw new Error(
				`C6 emitted next route references missing source maps: ${nextInventory.missingMaps
					.slice(0, 5)
					.join(", ")}`,
			);
		}
		if (!nextInventory.buildId) {
			throw new Error(`C6 emitted next BUILD_ID is missing: ${absolute}`);
		}
		const checked = validateEmittedInventory({
			name,
			host: name,
			moduleIds: nextInventory.moduleIds,
			sourceModuleIds: nextInventory.sourceModuleIds,
			entries: [HOST_ENTRIES.next, SHARED_SESSION_ENTRY],
		});
		const summary = summarizeNextEditorModules(nextInventory);
		console.log(
			`  PASS emitted ${name} route: ${summary.files} attributable files, ${summary.maps} source maps, ${summary.moduleIds} module IDs (${summary.sourceModuleIds} source IDs); build=${nextInventory.buildId ?? "<missing>"}; exact entries=${[HOST_ENTRIES.next, SHARED_SESSION_ENTRY].join(", ")}; attributable closure complete`,
		);
		for (const expected of checked.expectedInventory) {
			const actual = checked.inventory.find(
				(entry) => entry.root === expected.root,
			)?.files;
			console.log(
				`    ${expected.root}=expected:${expected.files}/actual:${actual ?? 0}`,
			);
		}
	}
}

function check() {
	const files = trackedFiles();
	if (files.length === 0) {
		console.error("FAIL no web editor source files were scanned");
		process.exit(1);
	}
	const fileSet = new Set(files);
	const missingSourceClosure = expectedSourceClosure().filter(
		(moduleId) => !fileSet.has(moduleId),
	);
	if (missingSourceClosure.length > 0) {
		console.error(
			`FAIL source inventory omitted attributable closure: ${formatMissingClosure(missingSourceClosure)}`,
		);
		process.exit(1);
	}
	const inventory = rootInventory(files);
	const missingRoots = inventory.filter(({ files: count }) => count === 0);
	if (missingRoots.length) {
		console.error(
			`FAIL required source roots missing: ${missingRoots.map(({ root }) => root).join(", ")}`,
		);
		process.exit(1);
	}
	const hits = files.flatMap((path) => {
		const absolute = join(ROOT, path);
		return existsSync(absolute)
			? scan(path, readFileSync(absolute, "utf8"))
			: [];
	});
	console.log(
		`check-session-resource-boundary: scanned ${files.length} web source modules`,
	);
	console.log(
		`  frozen attributable source closure: ${expectedSourceClosure().length} modules`,
	);
	console.log(`  registry: ${REGISTRY}`);
	console.log(
		`  required roots: ${inventory.map(({ root, files: count }) => `${root}=${count}`).join(", ")}`,
	);
	console.log(
		`  exact construct exemptions: ${[...CONSTRUCT_EXEMPTIONS.values()].reduce((sum, entries) => sum + entries.length, 0)}`,
	);
	for (const rule of RULES) {
		const count = hits.filter((hit) => hit.rule === rule.id).length;
		console.log(
			`  ${count === 0 ? "PASS" : "FAIL"} ${rule.id}: ${count} violation(s)`,
		);
	}
	if (hits.length > 0) {
		for (const hit of hits)
			console.error(`  [${hit.rule}] ${hit.path}:${hit.line}: ${hit.text}`);
		process.exit(1);
	}
	checkEmittedGraph();
	console.log(
		"\nclean — all non-exempt web editor acquisitions cross the session seam",
	);
}

function checkOneFile() {
	const logicalPath = normalize(process.argv[3] ?? "");
	const sourcePath = process.argv[4] ? resolve(process.argv[4]) : "";
	if (!logicalPath.startsWith(`${SOURCE_ROOT}/`) || !sourcePath) {
		console.error(
			"usage: node script/check-session-resource-boundary.mjs --scan-file <packages/editor-classic/src/path> <source-file>",
		);
		process.exit(2);
	}
	if (!existsSync(sourcePath)) {
		console.error(`C6 boundary scan source is missing: ${sourcePath}`);
		process.exit(2);
	}
	const hits = scan(logicalPath, readFileSync(sourcePath, "utf8"));
	for (const hit of hits) {
		console.error(`  [${hit.rule}] ${hit.path}:${hit.line}: ${hit.text}`);
	}
	if (hits.length > 0) process.exit(1);
	console.log(`clean single-file boundary scan: ${logicalPath}`);
}

if (process.argv[2] === "--scan-file") {
	checkOneFile();
} else {
	validateExpectedClosureFixture();
	if (process.argv.includes("--verify-provenance")) {
		verifyAnchoredProvenance();
	} else if (process.argv.includes("--negative-control")) negativeControl();
	else check();
}
