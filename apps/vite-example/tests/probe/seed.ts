/**
 * Seed data for the seeded-legacy-project migration probe.
 *
 * Every shape here is **derived from the repository's own fixtures**, not
 * invented: the project records follow `v1Project` in
 * `apps/web/src/services/storage/migrations/__tests__/fixtures/v1.ts` (top-level
 * `name`/`fps`/`canvasSize`, `scenes[].tracks: []`, no `metadata` and no
 * `settings` — which is what makes `isV2Project()` false and
 * `getProjectVersion()` return 1), and the legacy timeline / media-metadata
 * records follow the store names, key names and `keyPath: "id"` that
 * `IndexedDBAdapter` itself uses (`indexeddb-adapter.ts`: `set` writes
 * `{ id: key, ...value }`, `getDB` creates stores with `{ keyPath: "id" }`).
 *
 * The three projects are chosen to separate the sites that would otherwise share
 * one verdict:
 *
 * - **A** has a *scene-specific* legacy timeline database, so it is read through
 *   `v1-to-v2.ts:124` (site S3), and it has legacy media metadata saying its one
 *   media element is an `image`, which is read through `v1-to-v2.ts:160` (S5).
 * - **B** has only the *project-level* legacy timeline database and a main
 *   scene, so it can only be read through the fallback at `v1-to-v2.ts:133`
 *   (S4). It deliberately has **no** media metadata, so its media element must
 *   stay `video` — the contrast with A is what makes S5's verdict its own.
 * - **C** is already at the current schema version and must come out
 *   byte-identical, so the repair cannot start rewriting current projects.
 */

export const PROJECT_A = "probe-legacy-a";
export const PROJECT_B = "probe-legacy-b";
export const PROJECT_C = "probe-current-c";

export const PROJECT_A_NAME = "Legacy Probe Project A";
export const PROJECT_B_NAME = "Legacy Probe Project B";

export const SCENE_A = "scene-main-a";
export const SCENE_B = "scene-main-b";

/** A's media element; its legacy metadata says `image`. */
export const MEDIA_A = "probe-media-a-image";
/** B's media element; there is no metadata for it anywhere. */
export const MEDIA_B = "probe-media-b-unknown";

export const EL_A_MEDIA = "legacy-el-a-media";
export const EL_A_TEXT = "legacy-el-a-text";
export const EL_A_AUDIO = "legacy-el-a-audio";
export const EL_B_MEDIA = "legacy-el-b-media";

export const EL_A_MEDIA_NAME = "legacy-a-picture.png";
export const EL_A_TEXT_CONTENT = "Legacy probe caption A";
export const EL_A_AUDIO_NAME = "legacy-a-tone.wav";
export const EL_B_MEDIA_NAME = "legacy-b-clip.mp4";

export const PROJECTS_DB = "video-editor-projects";
export const PROJECTS_STORE = "projects";

export interface SeedStore {
	dbName: string;
	storeName: string;
	records: Record<string, unknown>[];
}

function v1ProjectRecord({
	id,
	name,
	sceneId,
}: {
	id: string;
	name: string;
	sceneId: string;
}): Record<string, unknown> {
	return {
		id,
		version: 1,
		name,
		createdAt: "2024-01-15T10:00:00.000Z",
		updatedAt: "2024-01-15T12:00:00.000Z",
		fps: 30,
		canvasSize: { width: 1920, height: 1080 },
		backgroundColor: "#1a1a1a",
		backgroundType: "color",
		currentSceneId: sceneId,
		bookmarks: [2, 4.5, 7],
		scenes: [
			{
				id: sceneId,
				name: "Main scene",
				isMain: true,
				// Empty on purpose: `transformProjectV1ToV2` only consults the legacy
				// timeline databases when a scene's `tracks` is missing or empty, so a
				// non-empty array here would skip S3/S4 entirely.
				tracks: [],
				bookmarks: [],
				createdAt: "2024-01-15T10:00:00.000Z",
				updatedAt: "2024-01-15T12:00:00.000Z",
			},
		],
	};
}

/**
 * A project already at the current version.
 *
 * Shaped like a v2+ record (`metadata` + `settings` + numeric `version`) so both
 * `getProjectVersion` and `isV2Project` agree it needs nothing, which is what
 * makes the runner `continue` past it.
 */
function currentProjectRecord({
	id,
	currentVersion,
}: {
	id: string;
	currentVersion: number;
}): Record<string, unknown> {
	return {
		id,
		version: currentVersion,
		metadata: {
			id,
			name: "Already Current Probe Project C",
			createdAt: "2026-07-30T00:00:00.000Z",
			updatedAt: "2026-07-30T00:00:00.000Z",
		},
		currentSceneId: "scene-c",
		scenes: [
			{
				id: "scene-c",
				name: "Main scene",
				isMain: true,
				tracks: { main: null, overlay: [], audio: [] },
				bookmarks: [],
				createdAt: "2026-07-30T00:00:00.000Z",
				updatedAt: "2026-07-30T00:00:00.000Z",
			},
		],
		settings: {
			fps: 30,
			canvasSize: { width: 1920, height: 1080 },
			background: { type: "color", color: "#000000" },
			originalCanvasSize: null,
		},
	};
}

const legacyTracksA = [
	{
		id: "legacy-track-a-media",
		name: "Legacy Media Track A",
		type: "media",
		elements: [
			{
				id: EL_A_MEDIA,
				name: EL_A_MEDIA_NAME,
				type: "media",
				mediaId: MEDIA_A,
				startTime: 0,
				duration: 5,
				trimStart: 0,
				trimEnd: 0,
			},
		],
	},
	{
		id: "legacy-track-a-text",
		name: "Legacy Text Track A",
		type: "text",
		elements: [
			{
				id: EL_A_TEXT,
				name: "Legacy Caption A",
				type: "text",
				content: EL_A_TEXT_CONTENT,
				fontSize: 24,
				startTime: 1,
				duration: 3,
				trimStart: 0,
				trimEnd: 0,
			},
		],
	},
	{
		id: "legacy-track-a-audio",
		name: "Legacy Audio Track A",
		type: "audio",
		elements: [
			{
				id: EL_A_AUDIO,
				name: EL_A_AUDIO_NAME,
				type: "audio",
				mediaId: "probe-media-a-audio",
				startTime: 0,
				duration: 4,
				trimStart: 0,
				trimEnd: 0,
			},
		],
	},
];

const legacyTracksB = [
	{
		id: "legacy-track-b-media",
		name: "Legacy Media Track B",
		type: "media",
		elements: [
			{
				id: EL_B_MEDIA,
				name: EL_B_MEDIA_NAME,
				type: "media",
				mediaId: MEDIA_B,
				startTime: 0,
				duration: 6,
				trimStart: 0,
				trimEnd: 0,
			},
		],
	},
];

export function buildSeed({
	currentVersion,
}: {
	currentVersion: number;
}): SeedStore[] {
	return [
		{
			dbName: PROJECTS_DB,
			storeName: PROJECTS_STORE,
			records: [
				v1ProjectRecord({
					id: PROJECT_A,
					name: PROJECT_A_NAME,
					sceneId: SCENE_A,
				}),
				v1ProjectRecord({
					id: PROJECT_B,
					name: PROJECT_B_NAME,
					sceneId: SCENE_B,
				}),
				currentProjectRecord({ id: PROJECT_C, currentVersion }),
			],
		},
		// S3's read: the per-scene legacy timeline database.
		{
			dbName: `video-editor-timelines-${PROJECT_A}-${SCENE_A}`,
			storeName: "timeline",
			records: [
				{
					id: "timeline",
					lastModified: "2024-01-15T12:00:00.000Z",
					tracks: legacyTracksA,
				},
			],
		},
		// S4's read: the project-level legacy timeline database, reached only as the
		// main-scene fallback. B deliberately has no per-scene database.
		{
			dbName: `video-editor-timelines-${PROJECT_B}`,
			storeName: "timeline",
			records: [
				{
					id: "timeline",
					lastModified: "2024-01-15T12:00:00.000Z",
					tracks: legacyTracksB,
				},
			],
		},
		// S5's read: legacy media metadata. Only A has any.
		{
			dbName: `video-editor-media-${PROJECT_A}`,
			storeName: "media-metadata",
			records: [
				{
					id: MEDIA_A,
					name: EL_A_MEDIA_NAME,
					type: "image",
					size: 12_345,
					lastModified: 1_705_312_800_000,
					width: 800,
					height: 600,
				},
			],
		},
	];
}

/**
 * Runs **inside the page**, before any application code has loaded.
 *
 * Creates each database at version 1 with `{ keyPath: "id" }`, which is exactly
 * what `IndexedDBAdapter.getDB()`'s `onupgradeneeded` would have created, so the
 * adapter later opens these without an upgrade and reads them as the legacy app
 * wrote them.
 */
export async function seedInPage(stores: SeedStore[]): Promise<string[]> {
	const created: string[] = [];
	for (const store of stores) {
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open(store.dbName, 1);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(store.storeName)) {
					db.createObjectStore(store.storeName, { keyPath: "id" });
				}
			};
			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const db = request.result;
				const transaction = db.transaction(store.storeName, "readwrite");
				const objectStore = transaction.objectStore(store.storeName);
				for (const record of store.records) objectStore.put(record);
				transaction.oncomplete = () => {
					db.close();
					resolve();
				};
				transaction.onerror = () => reject(transaction.error);
			};
		});
		created.push(`${store.dbName}/${store.storeName} x${store.records.length}`);
	}
	return created;
}
