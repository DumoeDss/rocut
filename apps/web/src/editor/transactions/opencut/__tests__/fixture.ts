/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- Focused fixtures intentionally construct branded donor times, opaque records, and an instrumented store. */
import type { ProjectRecord, ProjectStore } from "@opencut/editor-ports";
import { createInMemoryProjectStoreFixture } from "@opencut/editor-ports/in-memory";
import { encodeProject } from "@/editor/persistence/project-codec";
import type { TProject } from "@/project/types";
import type { SceneTracks } from "@/timeline";

export const TEST_PROJECT_ID = "opencut-routing-project";

export function projectFixture(): TProject {
	const tracks: SceneTracks = {
		main: {
			id: "main-track",
			name: "Main Track",
			type: "video",
			elements: [],
			muted: false,
			hidden: false,
		},
		overlay: [],
		audio: [],
	};
	return {
		metadata: {
			id: TEST_PROJECT_ID,
			name: "OpenCut routing",
			duration: 0 as TProject["metadata"]["duration"],
			createdAt: new Date("2026-08-10T00:00:00.000Z"),
			updatedAt: new Date("2026-08-10T00:00:00.000Z"),
		},
		scenes: [
			{
				id: "scene-main",
				name: "Main scene",
				isMain: true,
				tracks,
				bookmarks: [],
				createdAt: new Date("2026-08-10T00:00:00.000Z"),
				updatedAt: new Date("2026-08-10T00:00:00.000Z"),
			},
		],
		currentSceneId: "scene-main",
		settings: {
			fps: { numerator: 30, denominator: 1 },
			canvasSize: { width: 1920, height: 1080 },
			background: { type: "color", color: "#000000" },
		},
		version: 2,
	};
}

export function recordFixture(
	project = projectFixture(),
	opaque: Record<string, unknown> = {},
): ProjectRecord {
	return {
		id: project.metadata.id,
		schemaVersion: project.version,
		data: {
			...(encodeProject({ project, retained: {} }) as Record<string, unknown>),
			...opaque,
		},
	};
}

export async function storeFixture(project = projectFixture()) {
	const { store, control } = createInMemoryProjectStoreFixture();
	let saveCount = 0;
	const originalSave = store.save.bind(store);
	store.save = async (args) => {
		saveCount += 1;
		return originalSave(args);
	};
	await store.save({
		record: recordFixture(project, {
			nestedOpaque: { sentinel: ["keep", { value: 42 }] },
		}),
		summary: {
			id: project.metadata.id,
			name: project.metadata.name,
			createdAt: project.metadata.createdAt.toISOString(),
			updatedAt: project.metadata.updatedAt.toISOString(),
		},
	});
	saveCount = 0;
	return {
		store: store as ProjectStore,
		control,
		project,
		getSaveCount: () => saveCount,
	};
}
