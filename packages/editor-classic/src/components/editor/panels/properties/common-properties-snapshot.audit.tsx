// Explicit DOM audit: run this path with COMMON_PROPERTIES_DOM_DEPENDENCIES.
import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

if (process.env.COMMON_PROPERTIES_SNAPSHOT_ISOLATED !== "1") {
	test("common properties settles with the real session subscription", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, COMMON_PROPERTIES_SNAPSHOT_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
			timeout: 15000,
		});
		if (result.exitCode)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	}, 20000);
} else {
	const require = createRequire(import.meta.url);
	const dependencyRoot = process.env.COMMON_PROPERTIES_DOM_DEPENDENCIES;
	const { JSDOM } = require(
		require.resolve("jsdom", {
			paths: dependencyRoot ? [dependencyRoot] : [process.cwd()],
		}),
	);
	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		url: "http://localhost/",
	});
	for (const key of [
		"window",
		"document",
		"navigator",
		"Node",
		"Element",
		"HTMLElement",
		"HTMLInputElement",
		"Event",
	])
		Reflect.set(globalThis, key, dom.window[key]);
	Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
	await import("../../../../editor/session/__tests__/wasm-test-mock");
	const React = await import("react");
	const { act } = React;
	const { createRoot } = await import("react-dom/client");
	const { createEditorSession } =
		await import("../../../../editor/session/create-session");
	const { EditorSessionProvider } =
		await import("../../../../editor/session/editor-session-provider");
	const { editorForSession } =
		await import("../../../../editor/runtime/session-core-owner");
	const { EditorHostProvider } =
		await import("../../../../editor/host/editor-host-context");
	const { useEditor } = await import("../../../../editor/use-editor");
	const { createInMemoryHost } =
		await import("@opencut/editor-ports/in-memory/host");
	const { projectFixture } =
		await import("../../../../editor/transactions/opencut/__tests__/fixture");
	const { mediaTime } = await import("@opencut/editor-contracts");
	const { CommonProperties } = await import("./common-properties");

	test("one image then multiselect mounts without a snapshot loop and follows live changes", async () => {
		const project = projectFixture();
		const track = project.scenes[0].tracks.main;
		track.elements = [0, 1].map((index) => ({
			id: `image-${index}`,
			type: "image" as const,
			name: `Image ${index}`,
			mediaId: `media-${index}`,
			startTime: mediaTime({ ticks: index * 8000 }),
			duration: mediaTime({ ticks: 8000 }),
			trimStart: mediaTime({ ticks: 0 }),
			trimEnd: mediaTime({ ticks: 0 }),
			params: { opacity: 1 },
		}));
		const host = createInMemoryHost({ projectId: project.metadata.id });
		const session = await createEditorSession({ host });
		const editor = editorForSession(session);
		editor.project.setActiveProject({ project });
		editor.scenes.setScenes({
			scenes: project.scenes,
			activeSceneId: project.currentSceneId,
		});
		const select = (count: number) =>
			editor.selection.setSelectedElements({
				elements: track.elements
					.slice(0, count)
					.map((element) => ({ trackId: track.id, elementId: element.id })),
			});
		let commits = 0;
		function PropertiesGate() {
			const count = useEditor(
				(current) => current.selection.getSelectedElements().length,
			);
			return count > 1 ? <CommonProperties /> : null;
		}
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const opacity = () =>
			container.querySelector<HTMLInputElement>(
				'input[aria-label="Common Opacity"]',
			);
		try {
			select(1);
			await act(async () =>
				root.render(
					<EditorSessionProvider session={session}>
						<EditorHostProvider host={{ ...host, locale: "en" }}>
							<React.Profiler id="common" onRender={() => commits++}>
								<PropertiesGate />
							</React.Profiler>
						</EditorHostProvider>
					</EditorSessionProvider>,
				),
			);
			expect(opacity()).toBeNull();
			await act(async () => select(2));
			expect(opacity()?.value).toBe("1");
			expect(opacity()?.disabled).toBe(false);
			const settled = commits;
			await act(async () => {
				select(2);
				select(2);
			});
			expect(commits).toBe(settled);
			await act(async () =>
				editor.scenes.updateSceneTracks({
					tracks: {
						...project.scenes[0].tracks,
						main: {
							...track,
							elements: track.elements.map((element) => ({
								...element,
								params: { opacity: 0.4 },
							})),
						},
					},
				}),
			);
			expect(opacity()?.value).toBe("0.4");
			await act(async () =>
				editor.scenes.updateSceneTracks({
					tracks: {
						...editor.scenes.getActiveScene().tracks,
						main: {
							...editor.scenes.getActiveScene().tracks.main,
							locked: true,
						},
					},
				}),
			);
			expect(opacity()?.disabled).toBe(true);
			await act(async () => select(1));
			expect(opacity()).toBeNull();
			expect(commits).toBeLessThan(10);
		} finally {
			await act(async () => root.unmount());
			container.remove();
			await session.dispose();
			dom.window.close();
		}
	});
}
