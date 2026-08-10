import type { Command, EditorCommandContext } from "@/commands/base-command";
import type { EditorCore } from "@/core";
import type { MediaAsset } from "@/media/types";
import type { TProjectSettings } from "@/project/types";
import type { SceneTracks, TScene } from "@/timeline";
import { cloneOpaque } from "@/editor/persistence/opaque-value";
import type { OpenCutProjectDraft } from "./types";

function activeScene(draft: OpenCutProjectDraft): TScene {
	const scene = draft.project.scenes.find(
		(candidate) => candidate.id === draft.project.currentSceneId,
	);
	if (!scene) throw new Error("The detached OpenCut draft has no active scene");
	return scene;
}

function replaceActiveTracks(
	draft: OpenCutProjectDraft,
	tracks: SceneTracks,
): void {
	const active = activeScene(draft);
	draft.project.scenes = draft.project.scenes.map((scene) =>
		scene.id === active.id ? { ...scene, tracks: cloneOpaque(tracks) } : scene,
	);
}

export function createDetachedCommandContext({
	draft,
	assets,
}: {
	draft: OpenCutProjectDraft;
	assets: readonly MediaAsset[];
}): EditorCommandContext {
	let context: EditorCommandContext;
	const project = {
		getActive: () => draft.project,
		getActiveOrNull: () => draft.project,
		setActiveProject: ({ project: next }: { project: typeof draft.project }) => {
			draft.project = cloneOpaque(next);
		},
		updateSettings: ({
			settings,
		}: {
			settings: Partial<TProjectSettings>;
			pushHistory?: boolean;
		}) => {
			const { fps: _fps, canvasSize: _canvasSize, ...providerPrivate } =
				settings;
			draft.project = {
				...draft.project,
				settings: {
					...draft.project.settings,
					...cloneOpaque(providerPrivate),
				},
			};
		},
	};
	const scenes = {
		getActiveScene: () => activeScene(draft),
		getActiveSceneOrNull: () => activeScene(draft),
		getScenes: () => draft.project.scenes,
		setScenes: ({
			scenes: next,
			activeSceneId,
		}: {
			scenes: TScene[];
			activeSceneId?: string;
		}) => {
			draft.project = {
				...draft.project,
				scenes: cloneOpaque(next),
				currentSceneId: activeSceneId ?? draft.project.currentSceneId,
			};
		},
	};
	const timeline = {
		updateTracks: (tracks: SceneTracks) => replaceActiveTracks(draft, tracks),
	};
	const command = {
		executeWithoutHistory: ({ command: nested }: { command: Command }) =>
			nested.execute(context),
	};
	context = {
		editor: {
			project,
			scenes,
			timeline,
			media: { getAssets: () => [...assets] },
			save: { markDirty: () => undefined },
			command,
		} as unknown as EditorCore,
	};
	return context;
}
