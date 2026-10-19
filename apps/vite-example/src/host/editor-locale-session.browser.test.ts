import { expect, test } from "bun:test";
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

test("live locale preserves the editor session, host identity and unsaved draft", async () => {
	const editor = fileURLToPath(
		new URL("../../../../packages/editor-classic/src/editor/", import.meta.url),
	);
	const modulePath = (path: string) =>
		JSON.stringify(`${editor}${path}`.replaceAll("\\", "/"));
	const bundle = await Bun.build({
		entrypoints: ["locale-session-test"],
		target: "browser",
		plugins: [
			{
				name: "isolated-session-owners",
				setup(build) {
					build.onResolve({ filter: /^locale-session-test$/ }, () => ({
						path: "entry",
						namespace: "locale-test",
					}));
					build.onResolve(
						{ filter: /\/(create-session|wasm-runtime-providers)$/ },
						({ path, importer }) => {
							if (!importer.endsWith("editor-session-host.tsx")) return;
							return { path, namespace: "locale-test" };
						},
					);
					build.onLoad(
						{ filter: /.*/, namespace: "locale-test" },
						({ path }) => {
							if (path.endsWith("create-session"))
								return {
									loader: "js",
									contents: `
						export async function createEditorSession({ host }) {
							window.stats.creates++;
							return { id: host.projectId, dispose: async () => { window.stats.disposes++; } };
						}`,
								};
							if (path.endsWith("wasm-runtime-providers"))
								return {
									loader: "js",
									contents: `
						export async function prepareWasmRuntimeProviders() {
							return { runtimeGraphics: null, runtimeGpu: null, dispose: async () => {} };
						}`,
								};
							return {
								loader: "tsx",
								resolveDir: fileURLToPath(new URL(".", import.meta.url)),
								contents: `
						import React, { useState } from "react";
						import { createRoot } from "react-dom/client";
						import { EditorSessionHost } from ${modulePath("session/editor-session-host.tsx")};
						import { useEditorSession } from ${modulePath("session/editor-session-provider.tsx")};
						import { EditorLocaleProvider, useEditorHost, useEditorMessages } from ${modulePath("host/editor-host-context.tsx")};
						window.stats = { creates: 0, disposes: 0, preserved: true };
						const host = { projectId: "project-one", locale: "zh" };
						let previousSession;
						function Probe() {
							const session = useEditorSession();
							const currentHost = useEditorHost();
							window.stats.preserved &&= currentHost === host && (!previousSession || previousSession === session);
							previousSession = session;
							const [draft, setDraft] = useState("");
							return <><span id="copy">{useEditorMessages().undo}</span><input aria-label="draft" value={draft} onChange={event => setDraft(event.target.value)} /></>;
						}
						const root = createRoot(document.getElementById("root"));
						window.changeLocale = locale => root.render(<EditorSessionHost host={host}><EditorLocaleProvider locale={locale}><Probe /></EditorLocaleProvider></EditorSessionHost>);
						window.changeLocale("en");
					`,
							};
						},
					);
				},
			},
		],
	});
	if (!bundle.success)
		throw new AggregateError(bundle.logs, "Locale test bundle failed");
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.setContent('<div id="root"></div>');
		await page.addScriptTag({ content: await bundle.outputs[0].text() });
		await page.getByLabel("draft").fill("unsaved project document");
		expect(await page.locator("#copy").textContent()).toBe("Undo");
		await page.evaluate(() => Reflect.get(window, "changeLocale")("zh-CN"));
		await page.waitForFunction(
			() => document.getElementById("copy")?.textContent !== "Undo",
		);
		expect(await page.getByLabel("draft").inputValue()).toBe(
			"unsaved project document",
		);
		expect(await page.evaluate(() => Reflect.get(window, "stats"))).toEqual({
			creates: 1,
			disposes: 0,
			preserved: true,
		});
	} finally {
		await browser.close();
	}
}, 30000);
