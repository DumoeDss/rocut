import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isC4ProjectLoadComplete } from "../../../host/c4-project-load";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../../../../..");

function source(path: string): string {
	return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

function withoutComments(value: string): string {
	return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("public Surface composition", () => {
	test("renders one bounded root in the caller tree and binds the exact target", () => {
		const runtime = withoutComments(
			source("packages/editor-classic/src/editor/surface/embedding/editor-surface.tsx"),
		);
		expect(runtime.match(/data-editor-surface=/g)).toHaveLength(1);
		expect(runtime).toContain('className={cn("size-full", className)}');
		expect(runtime).toContain("mount({ session, target: root })");
		expect(runtime).not.toMatch(/\b(?:createRoot|hydrateRoot|ReactDOM)\b/);
		expect(runtime).not.toMatch(/\b(?:h-screen|w-screen|100vh|100vw)\b/);
	});

	test("derives providers from session and keeps EditorRoot inside the public component", () => {
		const runtime = source(
			"packages/editor-classic/src/editor/surface/embedding/editor-surface.tsx",
		);
		const hostProvider = runtime.indexOf(
			"<EditorHostProvider host={session.host}>",
		);
		const sessionProvider = runtime.indexOf(
			"<EditorSessionProvider session={session}>",
		);
		const editorProvider = runtime.indexOf("<EditorProvider");
		const editorRoot = runtime.indexOf("<EditorRoot />");
		expect(hostProvider).toBeGreaterThan(-1);
		expect(sessionProvider).toBeGreaterThan(hostProvider);
		expect(editorProvider).toBeGreaterThan(sessionProvider);
		expect(editorRoot).toBeGreaterThan(editorProvider);
		expect(runtime).toContain("targetRef: rootRef");
		expect(runtime).toContain("FOCUS_MODE_MATRIX[focusMode].keyboard");
	});

	test("exports the runtime while public props and commit payload stay frozen", () => {
		const barrel = source("packages/editor-classic/src/editor/surface/embedding/index.ts");
		const types = source("packages/editor-classic/src/editor/surface/embedding/types.ts");
		const assertions = source(
			"packages/editor-classic/src/editor/surface/embedding/surface-contract.assertions.ts",
		);
		expect(barrel).toContain(
			'export { EditorSurface } from "./editor-surface";',
		);
		expect(types).toContain("readonly session: EditorSession;");
		expect(types).toContain("commit(args: { edit: unknown }): void;");
		expect(assertions).toContain('RequiredKeys<EditorSurfaceProps>, "session"');
		expect(barrel).not.toMatch(
			/Transaction(?:Apply|Batch|Result)|EditorCore|SessionOpenCutTransactions/,
		);
	});

	test("session bridge reuses one canonical facade without an engine or event path", () => {
		const bridge = withoutComments(
			source(
				"packages/editor-classic/src/editor/surface/embedding/session-surface-bridge.tsx",
			),
		);
		expect(bridge).toContain("editorForSession(session).transactions");
		expect(bridge).toMatch(/useMemo\([\s\S]*?\[[^\]]*session[^\]]*\]/);
		expect(bridge).not.toMatch(
			/createTransactionEngine|new\s+SessionOpenCutTransactions|addEventListener|invokeAction|executeCommand/,
		);
	});

	test("both production Hosts consume the same focused Surface contract", () => {
		const next = source("apps/web/src/app/editor/[project_id]/page.tsx");
		const vite = source("apps/vite-example/src/app.tsx");
		for (const host of [next, vite]) {
			expect(host).toContain('<SessionEditorSurface focusMode="focused" />');
			expect(host).not.toContain("<EditorRoot");
			expect(host).not.toContain("<EditorProvider");
		}
		expect(next).toContain('className="h-screen w-screen"');
		expect(next).toContain("<C4NextRuntimeProbe");
		expect(next).toContain("<ChangelogNotification />");
		expect(vite).toContain("<HostChrome>");
		expect(vite).toContain("<ProjectPicker");
		expect(vite).toContain("<EditorErrorBoundary>");
	});

	test("keeps the Host-owned C4 probe behind full project-load completion", () => {
		const page = source("apps/web/src/app/editor/[project_id]/page.tsx");
		const probe = withoutComments(
			source("apps/web/src/editor/host/c4-next-runtime-probe.tsx"),
		);
		const gate = withoutComments(
			source("packages/editor-classic/src/editor/host/c4-project-load.ts"),
		);
		expect(page).toContain("<C4NextRuntimeProbe");
		expect(page).toContain('<SessionEditorSurface focusMode="focused" />');
		expect(probe).toContain("useEditor(isC4ProjectLoadComplete)");
		expect(probe).toContain("if (!projectLoaded) return;");
		expect(gate).toContain("editor.project.getActiveOrNull() !== null");
		expect(gate).toContain("!editor.project.getIsLoading()");

		let activeProject: object | null = null;
		let loading = true;
		const editor = {
			project: {
				getActiveOrNull: () => activeProject,
				getIsLoading: () => loading,
			},
		};
		expect(isC4ProjectLoadComplete(editor)).toBe(false);
		activeProject = {};
		// Active publishes before ProjectManager's remaining async load phases.
		expect(isC4ProjectLoadComplete(editor)).toBe(false);
		loading = false;
		expect(isC4ProjectLoadComplete(editor)).toBe(true);
	});
});
