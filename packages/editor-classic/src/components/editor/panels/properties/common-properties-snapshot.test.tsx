import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.COMMON_PROPERTIES_SELECTOR_ISOLATED !== "1") {
	test("common property snapshots retain real session members", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, COMMON_PROPERTIES_SELECTOR_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
			timeout: 15000,
		});
		if (result.exitCode)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	}, 20000);
} else {
	await import("../../../../editor/session/__tests__/wasm-test-mock");
	const { renderToStaticMarkup } = await import("react-dom/server");
	const { createEditorSession } =
		await import("../../../../editor/session/create-session");
	const { EditorSessionProvider } =
		await import("../../../../editor/session/editor-session-provider");
	const { editorForSession } =
		await import("../../../../editor/runtime/session-core-owner");
	const { EditorHostProvider } =
		await import("../../../../editor/host/editor-host-context");
	const { createInMemoryHost } =
		await import("@opencut/editor-ports/in-memory/host");
	const { projectFixture } =
		await import("../../../../editor/transactions/opencut/__tests__/fixture");
	const { mediaTime } = await import("@opencut/editor-contracts");
	const {
		CommonProperties,
		selectCommonPropertyElements,
		selectCommonPropertyTracks,
	} = await import("./common-properties");

	test("production selectors shallow-settle and preserve selection, element and track updates", async () => {
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
		const select = (indices: number[]) =>
			editor.selection.setSelectedElements({
				elements: indices.map((index) => ({
					trackId: track.id,
					elementId: track.elements[index].id,
				})),
			});
		const render = () =>
			renderToStaticMarkup(
				<EditorSessionProvider session={session}>
					<EditorHostProvider host={{ ...host, locale: "en" }}>
						<CommonProperties />
					</EditorHostProvider>
				</EditorSessionProvider>,
			);
		try {
			select([0]);
			expect(selectCommonPropertyElements({ editor })).toEqual([
				track.elements[0],
			]);
			select([0, 1]);
			const elements = selectCommonPropertyElements({ editor });
			const tracks = selectCommonPropertyTracks({ editor });
			for (let i = 0; i < 3; i++) {
				select([0, 1]);
				expect(
					selectCommonPropertyElements({ editor }).every((element, index) =>
						Object.is(element, elements[index]),
					),
				).toBe(true);
				expect(
					selectCommonPropertyTracks({ editor }).every((value, index) =>
						Object.is(value, tracks[index]),
					),
				).toBe(true);
			}
			expect(render()).toContain('aria-label="Common Opacity"');
			const changed = { ...track.elements[0], params: { opacity: 0.4 } };
			editor.scenes.updateSceneTracks({
				tracks: {
					...project.scenes[0].tracks,
					main: { ...track, elements: [changed, track.elements[1]] },
				},
			});
			expect(selectCommonPropertyElements({ editor })[0]).toBe(changed);
			expect(selectCommonPropertyElements({ editor })[1]).toBe(elements[1]);
			expect(render()).toContain('placeholder="Multiple values"');
			const lockedTrack = {
				...editor.scenes.getActiveScene().tracks.main,
				locked: true,
			};
			editor.scenes.updateSceneTracks({
				tracks: { ...editor.scenes.getActiveScene().tracks, main: lockedTrack },
			});
			expect(
				selectCommonPropertyTracks({ editor }).every(
					(value) => value === lockedTrack,
				),
			).toBe(true);
			expect(render()).toContain("disabled");
			select([1]);
			expect(selectCommonPropertyElements({ editor })).toEqual([elements[1]]);
			select([]);
			expect(selectCommonPropertyElements({ editor })).toEqual([]);
			expect(selectCommonPropertyTracks({ editor })).toEqual([]);
			expect(render()).toBe("");
		} finally {
			await session.dispose();
		}
	});
}
