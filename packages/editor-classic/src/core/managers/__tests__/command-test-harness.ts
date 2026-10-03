/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- Shared durable command harness with intentionally narrowed EditorCore collaborators. */
import type { EditorCore } from "../..";
import type { MediaAsset } from "../../../media/types";
import type { TProject } from "../../../project/types";
import type { TScene } from "../../../timeline";
await import("../../../editor/session/__tests__/wasm-test-mock");
const { CommandManager } = await import("../commands");
const { SelectionManager } = await import("../selection-manager");
const { TimelineManager } = await import("../timeline-manager");
const { SessionPersistenceCoordinator } =
	await import("../../../editor/persistence");
const { cloneOpaque } =
	await import("../../../editor/persistence/opaque-value");
const { ProjectMutationArbiter, SessionOpenCutTransactions } =
	await import("../../../editor/transactions/opencut");
const { projectFixture, storeFixture, TEST_PROJECT_ID } =
	await import("../../../editor/transactions/opencut/__tests__/fixture");

export async function commandHarness(
	project = projectFixture(),
	assets: MediaAsset[] = [],
) {
	const fixture = await storeFixture(project);
	const arbiter = new ProjectMutationArbiter();
	const persistence = new SessionPersistenceCoordinator(fixture.store, arbiter);
	await persistence.loadProject({ id: TEST_PROJECT_ID });
	let liveProject = cloneOpaque(project);
	let liveScenes = cloneOpaque(project.scenes);
	let dirtySignals = 0;
	const failures: unknown[] = [];
	const editor = {} as EditorCore;
	Object.assign(editor, {
		persistence,
		project: {
			getActive: () => liveProject,
			getActiveOrNull: () => liveProject,
			setActiveProject: ({ project: next }: { project: TProject }) => {
				liveProject = cloneOpaque(next);
			},
			adoptCommittedProject: ({ project: next }: { project: TProject }) => {
				liveProject = cloneOpaque(next);
			},
		},
		scenes: {
			getScenes: () => liveScenes,
			getActiveScene: () =>
				liveScenes.find((scene) => scene.id === liveProject.currentSceneId)!,
			getActiveSceneOrNull: () =>
				liveScenes.find((scene) => scene.id === liveProject.currentSceneId) ??
				null,
			adoptCommittedScenes: ({ scenes }: { scenes: TScene[] }) => {
				liveScenes = cloneOpaque(scenes);
			},
			updateSceneTracks: ({ tracks }: { tracks: TScene["tracks"] }) => {
				liveScenes = liveScenes.map((scene) =>
					scene.id === liveProject.currentSceneId
						? { ...scene, tracks: cloneOpaque(tracks) }
						: scene,
				);
			},
		},
		media: { getAssets: () => assets },
		playback: { getCurrentTime: () => 0 as never },
		save: { markDirty: () => dirtySignals++ },
		reportPersistenceFailure: ({ error }: { error: unknown }) =>
			failures.push(error),
	});
	const selection = new SelectionManager(editor);
	Object.assign(editor, { selection });
	const transactions = new SessionOpenCutTransactions({
		persistence,
		arbiter,
		publish: (draft) => {
			liveProject = cloneOpaque(draft.project);
			liveScenes = cloneOpaque(draft.project.scenes);
		},
	});
	Object.assign(editor, { transactions });
	await transactions.open({ projectId: TEST_PROJECT_ID, assets });
	const command = new CommandManager(editor);
	Object.assign(editor, { command });
	const timeline = new TimelineManager(editor);
	Object.assign(editor, { timeline });
	command.registerReactor(({ editor: target }) => {
		const tracks = target.scenes.getActiveScene().tracks;
		const pruned = {
			...tracks,
			overlay: tracks.overlay.filter((track) => track.elements.length > 0),
			audio: tracks.audio.filter((track) => track.elements.length > 0),
		};
		if (
			pruned.overlay.length !== tracks.overlay.length ||
			pruned.audio.length !== tracks.audio.length
		) {
			target.timeline.updateTracks(pruned);
		}
	});
	return {
		fixture,
		editor,
		command,
		timeline,
		transactions,
		failures,
		getProject: () => liveProject,
		getScenes: () => liveScenes,
		getDirtySignals: () => dirtySignals,
	};
}
