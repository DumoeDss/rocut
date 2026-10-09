import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { assertRecipeModuleIdentity } from "./programmatic-recipe-editor-build.mjs";

test("recipe import audit rejects shared WASM and test-mock shortcuts", () => {
	for (const id of [
		"E:/repo/node_modules/opencut-wasm/opencut_wasm.js",
		"E:\\repo\\node_modules\\opencut-wasm\\opencut_wasm_sync.js",
		"bun:test",
		"E:/repo/src/__tests__/fixture.ts",
		"wasm-test-mock",
	])
		expect(() => assertRecipeModuleIdentity(id)).toThrow();
	for (const id of [
		"E:/private/opencut_wasm.js",
		"E:/repo/src/editor/session/create-session.ts",
		"\0rocut-html-private-wasm",
	])
		expect(() => assertRecipeModuleIdentity(id)).not.toThrow();
});
test("recipe runner uses explicit private surfaces and genuine browser/session/command paths", () => {
	const read = (file: string) =>
		readFileSync(new URL(file, import.meta.url), "utf8");
	const runner = read("../probe-programmatic-recipe-editor.mjs"),
		session = read("./programmatic-recipe-editor-session.ts"),
		browser = read("./programmatic-recipe-editor-browser.tsx"),
		checks = read("./programmatic-recipe-editor-checks.mjs");
	expect(runner).toContain("ROCUT_TEST_BROWSER_EXECUTABLE");
	expect(runner).toContain("assertHtmlProbeWasmIdentity");
	expect(runner).not.toContain("chromium.executablePath");
	expect(runner).not.toContain("connectOverCDP");
	expect(session).toContain("createEditorSession");
	expect(session).toContain("host.store.load");
	expect(browser).toContain("renderProgrammaticCanvas");
	expect(browser).toContain("GraphicTab");
	expect(checks).toContain("getImageData");
	expect(checks).toContain("await apply.click()");
	expect(checks).toContain("await recipe.fill(");
	expect(checks).toContain("assert.deepEqual(await record(), persisted)");
	expect(checks).toContain("External compiled update");
	expect(checks).toContain("External inline update");
});
