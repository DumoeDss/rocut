#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = JSON.parse(
	readFileSync(
		join(ROOT, "script/fixtures/session-state-ownership.json"),
		"utf8",
	),
);
const STORE_MODULES = [
	["apps/web/src/editor/panel-store.ts", "createPanelStore", "usePanelStore"],
	[
		"apps/web/src/editor/editor-store.ts",
		"createEditorStore",
		"useEditorStore",
	],
	[
		"apps/web/src/preview/preview-store.ts",
		"createPreviewStore",
		"usePreviewStore",
	],
	[
		"apps/web/src/timeline/timeline-store.ts",
		"createTimelineStore",
		"useTimelineStore",
	],
	[
		"apps/web/src/sounds/sounds-store.ts",
		"createSoundsStore",
		"useSoundsStore",
	],
	[
		"apps/web/src/timeline/components/graph-editor/custom-presets-store.ts",
		"createCustomPresetsStore",
		"useCustomPresetsStore",
	],
	[
		"apps/web/src/stickers/stickers-store.ts",
		"createStickersStore",
		"useStickersStore",
	],
	[
		"apps/web/src/actions/keybindings-store.ts",
		"createKeybindingsStore",
		"useKeybindingsStore",
	],
	[
		"apps/web/src/components/editor/panels/properties/stores/properties-store.ts",
		"createPropertiesStore",
		"usePropertiesStore",
	],
	[
		"apps/web/src/components/editor/panels/assets/assets-panel-store.tsx",
		"createAssetsPanelStore",
		"useAssetsPanelStore",
	],
];

function trackedSources() {
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
		],
		{ cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	)
		.split("\0")
		.filter((path) => /\.(ts|tsx)$/.test(path))
		.filter((path) => !path.includes("/__tests__/"))
		.filter((path) => existsSync(join(ROOT, path)))
		.map((path) => ({ path, source: readFileSync(join(ROOT, path), "utf8") }));
}

function editorAliases(source) {
	const aliases = new Set(["useEditor"]);
	for (const match of source.matchAll(
		/import\s*{([^}]+)}\s*from\s*["']@\/editor\/use-editor["']/g,
	)) {
		for (const part of match[1].split(",")) {
			const alias = /\buseEditor\s+as\s+(\w+)/.exec(part)?.[1];
			if (alias) aliases.add(alias);
		}
	}
	return aliases;
}

function forbiddenEditorAccess(source) {
	const scanned = source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/\/\/.*$/gm, " ");
	const failures = [];
	for (const alias of editorAliases(source)) {
		if (
			new RegExp("\\b" + alias + "\\s*(?:\\?\\.)?\\s*\\(\\s*\\)").test(scanned)
		) {
			failures.push("no-selector-editor-hook");
		}
	}
	if (/\bsubscribeNone\b/.test(scanned)) failures.push("subscribe-none");
	if (
		/useSyncExternalStore\s*\(\s*(?:\(\s*\)\s*=>\s*)?\(\s*\)\s*=>\s*(?:\{\s*\})?/s.test(
			scanned,
		)
	) {
		failures.push("empty-external-store-subscriber");
	}
	return failures;
}

function renderTimeImperativeCalls({ path, source }) {
	const sourceFile = ts.createSourceFile(
		path,
		source,
		ts.ScriptTarget.Latest,
		true,
		path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const failures = [];
	const unwrapValue = (expression) => {
		let current = expression;
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
	};
	const canonicalRenderCallbackHooks = new Set([
		"useMemo",
		"useState",
		"useReducer",
	]);
	const synchronousCollectionMethods = new Set([
		"map",
		"filter",
		"some",
		"every",
		"find",
		"reduce",
		"forEach",
	]);
	const renderCallbackHooks = new Map(
		[...canonicalRenderCallbackHooks].map((name) => [name, name]),
	);
	const editorHookAliases = new Set(["useEditorInstance"]);
	for (const statement of sourceFile.statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			!ts.isStringLiteral(statement.moduleSpecifier) ||
			!statement.importClause?.namedBindings ||
			!ts.isNamedImports(statement.importClause.namedBindings)
		) {
			continue;
		}
		for (const element of statement.importClause.namedBindings.elements) {
			const imported = element.propertyName?.text ?? element.name.text;
			if (
				statement.moduleSpecifier.text === "react" &&
				canonicalRenderCallbackHooks.has(imported)
			) {
				renderCallbackHooks.set(element.name.text, imported);
			}
			if (
				statement.moduleSpecifier.text === "@/editor/use-editor" &&
				imported === "useEditorInstance"
			) {
				editorHookAliases.add(element.name.text);
			}
		}
	}
	let foundHookAlias = true;
	while (foundHookAlias) {
		foundHookAlias = false;
		const findAliases = (node) => {
			if (
				ts.isVariableDeclaration(node) &&
				ts.isIdentifier(node.name) &&
				node.initializer
			) {
				const initializer = unwrapValue(node.initializer);
				if (
					ts.isIdentifier(initializer) &&
					editorHookAliases.has(initializer.text) &&
					!editorHookAliases.has(node.name.text)
				) {
					editorHookAliases.add(node.name.text);
					foundHookAlias = true;
				}
			}
			ts.forEachChild(node, findAliases);
		};
		findAliases(sourceFile);
	}

	const rootIdentifier = (expression) => {
		let current = expression;
		while (
			ts.isPropertyAccessExpression(current) ||
			ts.isElementAccessExpression(current)
		) {
			current = current.expression;
		}
		return ts.isIdentifier(current) ? current.text : null;
	};

	const nearestFunction = (node) => {
		let current = node.parent;
		while (current && !ts.isFunctionLike(current)) current = current.parent;
		return current;
	};

	const unwrapExpression = (node) => {
		let current = node;
		while (
			current.parent &&
			(ts.isParenthesizedExpression(current.parent) ||
				ts.isAsExpression(current.parent) ||
				ts.isTypeAssertionExpression(current.parent) ||
				ts.isNonNullExpression(current.parent)) &&
			current.parent.expression === current
		) {
			current = current.parent;
		}
		return current;
	};

	const calledName = (expression) => {
		expression = unwrapValue(expression);
		if (ts.isIdentifier(expression)) return expression.text;
		if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
		if (
			ts.isElementAccessExpression(expression) &&
			expression.argumentExpression &&
			ts.isStringLiteral(expression.argumentExpression)
		) {
			return expression.argumentExpression.text;
		}
		return null;
	};

	const executesDuringRender = (node) => {
		if (
			node.modifiers?.some(
				(modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
			)
		) {
			return false;
		}
		const expression = unwrapExpression(node);
		const parent = expression.parent;
		if (!ts.isCallExpression(parent)) return false;
		if (parent.expression === expression) return true;
		const hook = calledName(parent.expression);
		const canonicalHook = hook ? renderCallbackHooks.get(hook) : null;
		const argumentIndex = parent.arguments.indexOf(expression);
		if (canonicalHook === "useReducer") return argumentIndex === 2;
		if (canonicalHook) return argumentIndex === 0;
		return (
			argumentIndex === 0 &&
			hook !== null &&
			synchronousCollectionMethods.has(hook)
		);
	};

	const propertyPath = (expression) => {
		const parts = [];
		let current = expression;
		while (
			ts.isPropertyAccessExpression(current) ||
			ts.isElementAccessExpression(current)
		) {
			if (ts.isPropertyAccessExpression(current)) {
				parts.unshift(current.name.text);
			} else if (
				current.argumentExpression &&
				ts.isStringLiteral(current.argumentExpression)
			) {
				parts.unshift(current.argumentExpression.text);
			} else {
				return null;
			}
			current = current.expression;
		}
		if (!ts.isIdentifier(current)) return null;
		parts.unshift(current.text);
		return parts;
	};

	const inspectBinding = (declaration) => {
		const initializer = declaration.initializer
			? unwrapValue(declaration.initializer)
			: null;
		if (
			!ts.isIdentifier(declaration.name) ||
			!initializer ||
			!ts.isCallExpression(initializer) ||
			!ts.isIdentifier(unwrapValue(initializer.expression)) ||
			!editorHookAliases.has(unwrapValue(initializer.expression).text)
		) {
			return;
		}

		const owner = nearestFunction(declaration);
		if (!owner?.body) return;
		const binding = declaration.name.text;
		const editorBindings = new Set([binding]);
		let foundEditorAlias = true;
		while (foundEditorAlias) {
			foundEditorAlias = false;
			const collectEditorAliases = (node) => {
				if (
					ts.isVariableDeclaration(node) &&
					ts.isIdentifier(node.name) &&
					node.initializer
				) {
					const value = unwrapValue(node.initializer);
					if (
						ts.isIdentifier(value) &&
						editorBindings.has(value.text) &&
						!editorBindings.has(node.name.text)
					) {
						editorBindings.add(node.name.text);
						foundEditorAlias = true;
					}
				}
				ts.forEachChild(node, collectEditorAliases);
			};
			collectEditorAliases(owner.body);
		}
		const managerBindings = new Set();
		let foundManagerAlias = true;
		while (foundManagerAlias) {
			foundManagerAlias = false;
			const collectManagerAliases = (node) => {
				if (ts.isVariableDeclaration(node) && node.initializer) {
					const value = unwrapValue(node.initializer);
					if (ts.isIdentifier(node.name)) {
						const parts = propertyPath(value);
						const aliasesManager =
							parts && editorBindings.has(parts[0]) && parts.length === 2;
						const aliasesAlias =
							ts.isIdentifier(value) && managerBindings.has(value.text);
						if (
							(aliasesManager || aliasesAlias) &&
							!managerBindings.has(node.name.text)
						) {
							managerBindings.add(node.name.text);
							foundManagerAlias = true;
						}
					} else if (
						ts.isObjectBindingPattern(node.name) &&
						ts.isIdentifier(value) &&
						editorBindings.has(value.text)
					) {
						for (const element of node.name.elements) {
							if (
								ts.isIdentifier(element.name) &&
								!managerBindings.has(element.name.text)
							) {
								managerBindings.add(element.name.text);
								foundManagerAlias = true;
							}
						}
					}
				}
				ts.forEachChild(node, collectManagerAliases);
			};
			collectManagerAliases(owner.body);
		}

		const localFunctions = new Map();
		const collectLocalFunctions = (node) => {
			if (ts.isFunctionDeclaration(node) && node.name) {
				localFunctions.set(node.name.text, node);
			} else if (
				ts.isVariableDeclaration(node) &&
				ts.isIdentifier(node.name) &&
				node.initializer
			) {
				const value = unwrapValue(node.initializer);
				if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
					localFunctions.set(node.name.text, value);
				}
			}
			ts.forEachChild(node, collectLocalFunctions);
		};
		collectLocalFunctions(owner.body);
		const scannedNamedFunctions = new Set();

		const record = (node, kind) => {
			const { line } = sourceFile.getLineAndCharacterOfPosition(
				node.getStart(sourceFile),
			);
			failures.push(
				`render-time-imperative-editor-${kind}:${path}:${line + 1}`,
			);
		};

		const scanSameExecutionLayer = (node, enteredFunction = false) => {
			if (ts.isFunctionLike(node) && !enteredFunction) {
				if (!executesDuringRender(node)) return;
				if (
					node.modifiers?.some(
						(modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
					)
				) {
					return;
				}
			}
			if (
				ts.isCallExpression(node) &&
				(editorBindings.has(rootIdentifier(node.expression)) ||
					managerBindings.has(rootIdentifier(node.expression))) &&
				node !== initializer
			) {
				record(node, "call");
			}
			if (ts.isCallExpression(node)) {
				const localName = calledName(node.expression);
				const localFunction = localName ? localFunctions.get(localName) : null;
				if (
					localFunction &&
					!localFunction.modifiers?.some(
						(modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
					) &&
					!scannedNamedFunctions.has(localFunction)
				) {
					scannedNamedFunctions.add(localFunction);
					scanSameExecutionLayer(localFunction.body, true);
				}
			}
			if (
				ts.isPropertyAccessExpression(node) ||
				ts.isElementAccessExpression(node)
			) {
				const parts = propertyPath(node);
				const isNestedRoot =
					(ts.isPropertyAccessExpression(node.parent) ||
						ts.isElementAccessExpression(node.parent)) &&
					node.parent.expression === node;
				const isCalled =
					ts.isCallExpression(node.parent) && node.parent.expression === node;
				if (
					parts &&
					((editorBindings.has(parts[0]) && parts.length >= 3) ||
						(managerBindings.has(parts[0]) && parts.length >= 2)) &&
					!isNestedRoot &&
					!isCalled
				) {
					record(node, "read");
				}
			}
			ts.forEachChild(node, (child) => scanSameExecutionLayer(child));
		};
		scanSameExecutionLayer(owner.body);
	};

	const visit = (node) => {
		if (ts.isVariableDeclaration(node)) inspectBinding(node);
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return [...new Set(failures)];
}

function serializedCanvasRendererMethods({ path, source }) {
	const sourceFile = ts.createSourceFile(
		path,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const serialized = new Set();
	const visit = (node) => {
		if (
			ts.isMethodDeclaration(node) &&
			node.name &&
			ts.isIdentifier(node.name) &&
			node.body
		) {
			let usesQueue = false;
			const scan = (child) => {
				if (
					ts.isCallExpression(child) &&
					ts.isPropertyAccessExpression(child.expression) &&
					child.expression.name.text === "runExclusive" &&
					ts.isPropertyAccessExpression(child.expression.expression) &&
					child.expression.expression.name.text === "compositor" &&
					child.expression.expression.expression.kind ===
						ts.SyntaxKind.ThisKeyword
				) {
					usesQueue = true;
				}
				ts.forEachChild(child, scan);
			};
			scan(node.body);
			if (usesQueue) serialized.add(node.name.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return serialized;
}

function zustandReactCreatorAliases(source) {
	const aliases = new Set();
	for (const match of source.matchAll(
		/import\s*{([\s\S]*?)}\s*from\s*["']zustand["']/g,
	)) {
		for (const part of match[1].split(",")) {
			const creator = /^\s*create(?:\s+as\s+(\w+))?\s*$/.exec(part);
			if (creator) aliases.add(creator[1] ?? "create");
		}
	}
	return aliases;
}

function forbiddenStaticStoreAccess(source) {
	const failures = [];
	for (const [path, , legacyHook] of STORE_MODULES) {
		const moduleSpec =
			"@/" + path.replace("apps/web/src/", "").replace(/\.[^.]+$/, "");
		for (const imported of source.matchAll(
			/import\s*{([\s\S]*?)}\s*from\s*["']([^"']+)["']/g,
		)) {
			if (
				imported[2] === moduleSpec &&
				new RegExp("\\b" + legacyHook + "\\b").test(imported[1])
			) {
				failures.push("direct-static-store-consumer:" + legacyHook);
			}
		}
		for (const imported of source.matchAll(
			/import\s*\*\s*as\s*(\w+)\s*from\s*["']([^"']+)["']/g,
		)) {
			if (
				imported[2] === moduleSpec &&
				new RegExp(
					"\\b" + imported[1] + "\\s*\\.\\s*" + legacyHook + "\\b",
				).test(source)
			) {
				failures.push("direct-static-store-consumer:" + legacyHook);
			}
		}
	}
	return failures;
}

function importedSpecifiers(source) {
	const specs = new Set();
	for (const match of source.matchAll(
		/\b(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s*)?["']([^"']+)["']/g,
	)) {
		specs.add(match[1]);
	}
	for (const match of source.matchAll(
		/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
	)) {
		specs.add(match[1]);
	}
	return specs;
}

function resolveModule({ from, spec, modules }) {
	let base;
	if (spec.startsWith("@/")) {
		base = "apps/web/src/" + spec.slice(2);
	} else if (spec.startsWith(".")) {
		base = posix.normalize(posix.join(posix.dirname(from), spec));
	} else {
		return null;
	}
	for (const candidate of [
		base,
		base + ".ts",
		base + ".tsx",
		posix.join(base, "index.ts"),
		posix.join(base, "index.tsx"),
	]) {
		if (modules.has(candidate)) return candidate;
	}
	return null;
}

function reachableModules({ modules, roots }) {
	const reachable = new Set();
	const queue = roots.filter((root) => modules.has(root));
	while (queue.length > 0) {
		const path = queue.shift();
		if (!path || reachable.has(path)) continue;
		reachable.add(path);
		for (const spec of importedSpecifiers(modules.get(path))) {
			const next = resolveModule({ from: path, spec, modules });
			if (next && !reachable.has(next)) queue.push(next);
		}
	}
	return reachable;
}

const PRODUCTION_ROOTS = [
	"apps/web/src/app/editor/[project_id]/page.tsx",
	"apps/web/src/app/projects/page.tsx",
	"apps/vite-example/src/host/vite-editor-host.tsx",
];

const REQUIRED_PRODUCTION_MODULES = [
	"apps/web/src/editor/session/editor-session-host.tsx",
	"apps/web/src/editor/session/create-session.ts",
	"apps/web/src/editor/runtime/wasm-runtime-providers.ts",
	"apps/web/src/services/renderer/compositor/wasm-compositor.ts",
];

const CONTRACT_FALLBACK_DEFINITIONS = new Set([
	"apps/web/src/editor/ports/index.ts",
	"apps/web/src/editor/ports/environment.ts",
	"apps/web/src/editor/session/create-session.ts",
]);

const HANDLE_ZERO_CALL =
	/\b(?:initCompositor|getCompositorCanvas|resizeCompositor|uploadTexture|renderFrame|releaseTexture)\s*\(/;

function productionGraphFailures({ modules, roots = PRODUCTION_ROOTS }) {
	const failures = [];
	for (const root of roots) {
		const reachable = reachableModules({ modules, roots: [root] });
		if (!reachable.has(root)) {
			failures.push("missing-production-root:" + root);
			continue;
		}
		for (const required of REQUIRED_PRODUCTION_MODULES) {
			if (!reachable.has(required)) {
				failures.push("production-root-misses:" + root + ":" + required);
			}
		}
		for (const path of reachable) {
			const source = modules
				.get(path)
				.replace(/\/\*[\s\S]*?\*\//g, " ")
				.replace(/\/\/.*$/gm, " ");
			for (const line of source.split(/\r?\n/)) {
				if (
					/UNIMPLEMENTED_RUNTIME_(?:GRAPHICS|GPU)/.test(line) &&
					!/^\s*export\s+const\s+UNIMPLEMENTED_RUNTIME_/.test(line) &&
					!CONTRACT_FALLBACK_DEFINITIONS.has(path)
				) {
					failures.push(
						"reachable-unimplemented-provider:" + root + ":" + path,
					);
				}
				if (HANDLE_ZERO_CALL.test(line)) {
					failures.push("reachable-handle-zero-call:" + root + ":" + path);
				}
			}
			if (/\bwasmCompositor\b/.test(source)) {
				failures.push("reachable-default-compositor:" + root + ":" + path);
			}
			if (
				(path === root ||
					path.includes("/host/") ||
					path.endsWith("editor-session-host.tsx")) &&
				/backend\s*:\s*["']|livePreviewLimit\s*:|concurrentCompositorInstances\s*:\s*\(\)\s*=>\s*\d/.test(
					source,
				)
			) {
				failures.push(
					"reachable-host-stamped-runtime-answer:" + root + ":" + path,
				);
			}
		}
		const hostSource = modules.get(
			"apps/web/src/editor/session/editor-session-host.tsx",
		);
		if (
			!hostSource ||
			!/prepareRuntime\s*=\s*prepareWasmRuntimeProviders/.test(hostSource) ||
			!/runtimeGraphics\s*:\s*runtime\.runtimeGraphics/.test(hostSource) ||
			!/runtimeGpu\s*:\s*runtime\.runtimeGpu/.test(hostSource)
		) {
			failures.push("production-host-does-not-supply-live-runtime:" + root);
		}
	}
	return [...new Set(failures)];
}

const SINGLETON_SCOPE =
	/^apps\/web\/src\/(editor|services\/renderer|effects|masks|graphics|stickers)\//;

const SINGLETON_MUTATORS = [
	"set",
	"add",
	"delete",
	"clear",
	"push",
	"pop",
	"shift",
	"unshift",
	"splice",
	"sort",
	"reverse",
	"fill",
	"copyWithin",
];

/**
 * Module-level bindings two sessions in one process would share *and write*.
 *
 * This rule used to match on shape — any top-level `new Map/Set/WeakMap`, or
 * any `let` — which cannot tell a frozen lookup table from live session state.
 * Eleven of the thirteen it flagged were module-local `const X = new Set([...])`
 * constants that are never written and never leave their file; adding them to
 * the ownership inventory would have grown it by eleven entries without making
 * anything safer, and would have taught the next author that the inventory is
 * a formality.
 *
 * It now matches on behaviour. A binding is in scope when it is declared `let`,
 * reassigned, written through a mutating method, or exported — exported stays
 * in scope because one file cannot prove another module does not write it.
 *
 * Residual, stated rather than papered over: a frozen local collection handed
 * out by reference could still be mutated through the alias by its caller. That
 * is invisible to a per-file scan; catching it needs real symbol resolution.
 */
function mutableSingletonSymbols(source) {
	const found = [];
	for (const line of source.split(/\r?\n/)) {
		const declaredLet = /^(?:export\s+)?let\s+(\w+)\b/.exec(line)?.[1];
		if (declaredLet !== undefined) {
			found.push(declaredLet);
			continue;
		}
		const symbol =
			/^(?:export\s+)?const\s+(\w+)[^=]*=\s*new\s+(?:Map|Set|WeakMap|WeakSet)/.exec(
				line,
			)?.[1];
		if (symbol === undefined) continue;
		const exported = new RegExp(`^export\\s+const\\s+${symbol}\\b`, "m").test(
			source,
		);
		const mutated = SINGLETON_MUTATORS.some((method) =>
			new RegExp(`\\b${symbol}\\s*\\.\\s*${method}\\s*\\(`).test(source),
		);
		const reassigned = new RegExp(`^\\s*${symbol}\\s*=[^=]`, "m").test(source);
		if (exported || mutated || reassigned) found.push(symbol);
	}
	return found;
}

function runNegativeControl() {
	const fixtures = [
		[
			"direct",
			'import { useEditor } from "@/editor/use-editor";\nuseEditor();',
			"no-selector-editor-hook",
		],
		[
			"alias",
			'import { useEditor as readCore } from "@/editor/use-editor";\nreadCore ( /* gap */ );',
			"no-selector-editor-hook",
		],
		[
			"optional",
			'import { useEditor as readCore } from "@/editor/use-editor";\nreadCore?.();',
			"no-selector-editor-hook",
		],
		[
			"subscribe-none",
			"const subscribeNone = () => () => {};",
			"subscribe-none",
		],
		[
			"empty-subscriber",
			"useSyncExternalStore(() => () => {}, getSnapshot, getSnapshot);",
			"empty-external-store-subscriber",
		],
	];
	let clean = true;
	for (const [name, source, expected] of fixtures) {
		const caught = forbiddenEditorAccess(source).includes(expected);
		console.log("  " + (caught ? "PASS " : "FAIL ") + name + ": " + expected);
		clean &&= caught;
	}
	for (const source of [
		"useEditor((editor) => editor.project.getActive());",
		"useEditorInstance();",
	]) {
		const accepted = forbiddenEditorAccess(source).length === 0;
		console.log("  " + (accepted ? "PASS" : "FAIL") + " positive: " + source);
		clean &&= accepted;
	}

	// The mutable-singleton rule, proven to fire on every way a binding becomes
	// writable, and proven not to fire on a frozen module-local lookup table.
	for (const [name, source] of [
		["written-map", "const byId = new Map();\nbyId.set(k, v);"],
		["written-set", "const seen = new Set();\nseen.add(k);"],
		["cleared", "const cache = new Map();\ncache.clear();"],
		["exported", "export const shared = new Set();"],
		["let-binding", "let current = null;"],
		["reassigned", "const box = new Map();\nbox = other;"],
		[
			"weakmap-written",
			"const perEngine = new WeakMap();\nperEngine.set(engine, capture);",
		],
	]) {
		const caught = mutableSingletonSymbols(source).length > 0;
		console.log("  " + (caught ? "PASS " : "FAIL ") + "singleton/" + name);
		clean &&= caught;
	}
	for (const [name, source] of [
		["frozen-local-set", 'const KEYS = new Set(["a", "b"]);\nif (KEYS.has(x)) run();'],
		["frozen-local-map", "const LABELS = new Map([[1, 'a']]);\nLABELS.get(1);"],
	]) {
		const quiet = mutableSingletonSymbols(source).length === 0;
		console.log("  " + (quiet ? "PASS " : "FAIL ") + "singleton-positive/" + name);
		clean &&= quiet;
	}
	const renderTimeCaught = renderTimeImperativeCalls({
		path: "render-time.tsx",
		source:
			"function Probe() { const editor = useEditorInstance(); const duration = editor.timeline.getTotalDuration(); return duration; }",
	}).some((failure) =>
		failure.startsWith("render-time-imperative-editor-call:"),
	);
	console.log(
		"  " +
			(renderTimeCaught ? "PASS" : "FAIL") +
			" render-time-imperative-editor-call",
	);
	clean &&= renderTimeCaught;
	const eventOnlyAccepted =
		renderTimeImperativeCalls({
			path: "event-only.tsx",
			source:
				"function Probe() { const editor = useEditorInstance(); return <button onClick={() => editor.playback.seek({ time: 0 })} />; }",
		}).length === 0;
	console.log(
		"  " +
			(eventOnlyAccepted ? "PASS" : "FAIL") +
			" positive: event-only imperative editor",
	);
	clean &&= eventOnlyAccepted;
	for (const [name, source] of [
		[
			"render-time-iife",
			"function Probe() { const editor = useEditorInstance(); return (() => editor.timeline.getTotalDuration())(); }",
		],
		[
			"render-time-use-memo",
			'import { useMemo as derive } from "react"; function Probe() { const editor = useEditorInstance(); return derive(() => editor.project.getActive(), [editor]); }',
		],
		[
			"render-time-lazy-initializer",
			"function Probe() { const editor = useEditorInstance(); const [value] = useState(() => editor.renderer.isDegraded); return value; }",
		],
		[
			"render-time-manager-property",
			'function Probe() { const editor = useEditorInstance(); return editor.renderer["isDegraded"]; }',
		],
		[
			"render-time-imported-hook-alias",
			'import { useEditorInstance as useOwningEditor } from "@/editor/use-editor";\nfunction Probe() { const editor = useOwningEditor?.(); return editor.project.getActive(); }',
		],
		[
			"render-time-local-hook-alias",
			"function Probe() { const useOwningEditor = useEditorInstance; const editor = useOwningEditor(); return editor.timeline.getTotalDuration(); }",
		],
		[
			"render-time-manager-alias",
			"function Probe() { const editor = useEditorInstance(); const project = editor.project; return project.getActive(); }",
		],
		[
			"render-time-named-local-call",
			"function Probe() { const editor = useEditorInstance(); function read() { return editor.project.getActive(); } return read?.(); }",
		],
		...["map", "filter", "some", "every", "find", "reduce", "forEach"].map(
			(method) => [
				`render-time-collection-${method}`,
				`function Probe({ values }) {\n  const editor = useEditorInstance();\n  return values?.${method}?.((value) => value && editor.project.getActive());\n}`,
			],
		),
	]) {
		const caught = renderTimeImperativeCalls({
			path: `${name}.tsx`,
			source,
		}).some((failure) => failure.startsWith("render-time-imperative-editor-"));
		console.log("  " + (caught ? "PASS " : "FAIL ") + name);
		clean &&= caught;
	}
	for (const [name, source] of [
		[
			"effect-manager-read",
			"function Probe() { const editor = useEditorInstance(); useEffect(() => { void editor.renderer.isDegraded; }, [editor]); return null; }",
		],
		[
			"event-manager-read",
			"function Probe() { const editor = useEditorInstance(); return <button onClick={() => void editor.renderer.isDegraded} />; }",
		],
		[
			"async-callback-manager-read",
			"function Probe() { const editor = useEditorInstance(); queueMicrotask(async () => void editor.renderer.isDegraded); return null; }",
		],
	]) {
		const accepted =
			renderTimeImperativeCalls({ path: `${name}.tsx`, source }).length === 0;
		console.log("  " + (accepted ? "PASS " : "FAIL ") + "positive: " + name);
		clean &&= accepted;
	}
	const missing = inventory.storeKeys.slice(0, 8);
	const caughtMissing = missing.length !== 9 || new Set(missing).size !== 9;
	console.log(
		"  " + (caughtMissing ? "PASS" : "FAIL") + " missing-ninth-store",
	);
	clean &&= caughtMissing;
	for (const [name, source, expected] of [
		[
			"aliased-zustand-creator",
			'import { create as makeStore } from "zustand";\nexport const usePanelStore = makeStore(() => ({}));',
			"module-created-react-store",
		],
		[
			"renamed-static-store-import",
			'import { usePanelStore as readPanel } from "@/editor/panel-store";\nreadPanel();',
			"direct-static-store-consumer",
		],
		[
			"comment-whitespace-static-store-import",
			'import { /* old */ usePreviewStore   as readPreview } from "@/preview/preview-store";\nreadPreview();',
			"direct-static-store-consumer",
		],
		[
			"namespace-static-store-import",
			'import * as panelState from "@/editor/panel-store";\npanelState.usePanelStore();',
			"direct-static-store-consumer",
		],
	]) {
		const caught =
			expected === "module-created-react-store"
				? zustandReactCreatorAliases(source).size > 0
				: forbiddenStaticStoreAccess(source).some((failure) =>
						failure.startsWith(expected),
					);
		console.log("  " + (caught ? "PASS " : "FAIL ") + name + ": " + expected);
		clean &&= caught;
	}

	const graphModules = new Map([
		["root.ts", 'import "./wrapper";'],
		["wrapper.ts", 'import * as runtime from "./bad"; void runtime;'],
		[
			"bad.ts",
			"const provider = UNIMPLEMENTED_RUNTIME_GPU;\nrenderFrame({});\nconst answer = { backend: 'webgpu' };",
		],
	]);
	const graphReachable = reachableModules({
		modules: graphModules,
		roots: ["root.ts"],
	});
	const wrapperCaught = graphReachable.has("bad.ts");
	const badSource = graphModules.get("bad.ts");
	const graphControls = [
		["transitive-wrapper", wrapperCaught],
		["namespace-unimplemented", /UNIMPLEMENTED_RUNTIME_GPU/.test(badSource)],
		["namespace-handle-zero", HANDLE_ZERO_CALL.test(badSource)],
		["host-stamped-answer", /backend\s*:\s*["']/.test(badSource)],
	];
	for (const [name, caught] of graphControls) {
		console.log(
			"  " + (caught ? "PASS " : "FAIL ") + name + ": production-graph",
		);
		clean &&= caught;
	}
	if (!clean) process.exit(1);
	console.log(
		"check-session-state-boundary: every negative control failed for its intended reason",
	);
}

function runCheck() {
	const sources = trackedSources();
	const byPath = new Map(sources.map((entry) => [entry.path, entry.source]));
	const failures = [];

	for (const [path, factory, legacyHook] of STORE_MODULES) {
		const source = byPath.get(path);
		if (!source) {
			failures.push("missing-store-module:" + path);
			continue;
		}
		if (
			!new RegExp("export\\s+function\\s+" + factory + "\\s*\\(").test(source)
		) {
			failures.push("missing-store-factory:" + path + ":" + factory);
		}
		if (
			new RegExp("export\\s+(?:const|function)\\s+" + legacyHook + "\\b").test(
				source,
			)
		) {
			failures.push("module-store-hook:" + path + ":" + legacyHook);
		}
		if (zustandReactCreatorAliases(source).size > 0) {
			failures.push("module-created-react-store:" + path);
		}
	}

	const registry =
		byPath.get("apps/web/src/editor/runtime/session-stores.ts") ?? "";
	const registryBlock =
		/EDITOR_SESSION_STORE_KEYS\s*=\s*\[([\s\S]*?)]\s*as const/.exec(
			registry,
		)?.[1] ?? "";
	const keys = [...registryBlock.matchAll(/["']([A-Za-z]+)["']/g)].map(
		(match) => match[1],
	);
	if (
		keys.length !== inventory.storeKeys.length ||
		new Set(keys).size !== inventory.storeKeys.length ||
		JSON.stringify(keys) !== JSON.stringify(inventory.storeKeys)
	) {
		failures.push("incomplete-or-duplicate-registry:" + keys.join(","));
	}

	for (const { path, source } of sources) {
		for (const rule of forbiddenEditorAccess(source)) {
			failures.push(rule + ":" + path);
		}
		failures.push(...renderTimeImperativeCalls({ path, source }));
		for (const failure of forbiddenStaticStoreAccess(source)) {
			failures.push(failure + ":" + path);
		}
	}

	const actualImperative = new Map();
	for (const { path, source } of sources) {
		if (path === "apps/web/src/editor/use-editor.ts") continue;
		const scanned = source
			.replace(/\/\*[\s\S]*?\*\//g, " ")
			.replace(/\/\/.*$/gm, " ");
		const count = scanned.match(/\buseEditorInstance\s*\(/g)?.length ?? 0;
		if (count > 0) actualImperative.set(path, count);
	}
	const expectedImperative = new Map(
		inventory.imperativeEditorConsumers.map((entry) => [
			entry.path,
			entry.count,
		]),
	);
	for (const [path, count] of actualImperative) {
		if (expectedImperative.get(path) !== count) {
			failures.push(
				"unclassified-imperative-editor-consumer:" +
					path +
					":" +
					count +
					"/" +
					(expectedImperative.get(path) ?? 0),
			);
		}
	}
	for (const [path, count] of expectedImperative) {
		if (actualImperative.get(path) !== count) {
			failures.push(
				"stale-imperative-classification:" +
					path +
					":" +
					(actualImperative.get(path) ?? 0) +
					"/" +
					count,
			);
		}
	}

	const modules = new Map(sources.map(({ path, source }) => [path, source]));
	failures.push(...productionGraphFailures({ modules }));

	const compositor =
		byPath.get(
			"apps/web/src/services/renderer/compositor/wasm-compositor.ts",
		) ?? "";
	if (/\bwasmCompositor\b/.test(compositor))
		failures.push("default-compositor");
	for (const name of [
		"initCompositor",
		"getCompositorCanvas",
		"resizeCompositor",
		"uploadTexture",
		"renderFrame",
		"releaseTexture",
	]) {
		if (new RegExp("\\b" + name + "\\s*\\(").test(compositor)) {
			failures.push("handle-zero-compositor-call:" + name);
		}
	}
	for (const required of [
		"createCompositor",
		"getCompositorCanvasForHandle",
		"resizeCompositorForHandle",
		"uploadTextureForHandle",
		"renderFrameForHandle",
	]) {
		if (!new RegExp("\\b" + required + "\\s*\\(").test(compositor)) {
			failures.push("missing-handle-keyed-call:" + required);
		}
	}

	const gpuRenderer =
		byPath.get("apps/web/src/services/renderer/gpu-renderer.ts") ?? "";
	if (/\b(?:gpuAvailable|initPromise)\b/.test(gpuRenderer)) {
		failures.push("module-gpu-readiness-singleton");
	}
	const canceller =
		byPath.get("apps/web/src/editor/cancel-interaction.ts") ?? "";
	if (!/WeakMap<EditorSession,\s*Set<CancelFn>>/.test(canceller)) {
		failures.push("interaction-canceller-not-session-keyed");
	}

	const rendererManager =
		byPath.get("apps/web/src/core/managers/renderer-manager.ts") ?? "";
	const projectManager =
		byPath.get("apps/web/src/core/managers/project-manager.ts") ?? "";
	const canvasRenderer =
		byPath.get("apps/web/src/services/renderer/canvas-renderer.ts") ?? "";
	const sceneExporter =
		byPath.get("apps/web/src/services/renderer/scene-exporter.ts") ?? "";
	if (
		(rendererManager.match(/new\s+WasmCompositor\s*\(/g)?.length ?? 0) !== 1
	) {
		failures.push("renderer-manager-must-own-one-compositor-constructor");
	}
	if (
		!new RegExp(
			"new\\s+CanvasRenderer\\s*\\(\\s*\\{[\\s\\S]*?compositor\\s*:\\s*this\\.compositor",
		).test(rendererManager)
	) {
		failures.push("preview-renderer-does-not-reuse-session-compositor");
	}
	if (
		!/createSnapshot\s*\(\)[\s\S]*?this\.createCanvasRenderer\s*\(/.test(
			rendererManager,
		)
	) {
		failures.push("snapshot-does-not-reuse-renderer-manager-factory");
	}
	if (
		!/new\s+SceneExporter\s*\(\s*\{[\s\S]*?compositor\s*:\s*this\.compositor/.test(
			rendererManager,
		)
	) {
		failures.push("export-does-not-reuse-session-compositor");
	}
	if (
		!/this\.editor\.renderer\.createCanvasRenderer\s*\(/.test(projectManager)
	) {
		failures.push("thumbnail-does-not-reuse-renderer-manager-factory");
	}
	if (
		!/compositor\s*:\s*WasmCompositor/.test(sceneExporter) ||
		!/new\s+CanvasRenderer\s*\(\s*\{[\s\S]*?compositor/.test(sceneExporter)
	) {
		failures.push("scene-exporter-does-not-require-injected-compositor");
	}
	if (
		!/renderAndCapture\s*\(\s*\{[\s\S]*?capture\s*:\s*\(\)\s*=>\s*videoSource\.add/.test(
			sceneExporter,
		)
	) {
		failures.push("scene-export-capture-escapes-compositor-transaction");
	}
	const serializedRendererMethods = serializedCanvasRendererMethods({
		path: "apps/web/src/services/renderer/canvas-renderer.ts",
		source: canvasRenderer,
	});
	for (const method of [
		"getOutputCanvas",
		"render",
		"renderAndCapture",
		"renderToCanvas",
	]) {
		if (!serializedRendererMethods.has(method)) {
			failures.push("canvas-render-path-not-serialized:" + method);
		}
	}

	const classifiedSymbols = new Set(
		inventory.processSharedMutable.map(
			(entry) => entry.path + ":" + entry.symbol,
		),
	);
	for (const { path, source } of sources) {
		if (!SINGLETON_SCOPE.test(path)) continue;
		for (const symbol of mutableSingletonSymbols(source)) {
			if (!classifiedSymbols.has(path + ":" + symbol)) {
				failures.push("unclassified-mutable-singleton:" + path + ":" + symbol);
			}
		}
	}

	if (failures.length > 0) {
		for (const failure of failures) console.error("  FAIL " + failure);
		process.exit(1);
	}
	console.log(
		"check-session-state-boundary: PASS " +
			STORE_MODULES.length +
			`/${inventory.storeKeys.length} factories, ` +
			keys.length +
			`/${inventory.storeKeys.length} registry keys, ` +
			actualImperative.size +
			" classified imperative modules, no default/handle-0/unimplemented production path",
	);
}

if (process.argv.includes("--negative-control")) runNegativeControl();
else runCheck();
