import type { Page } from "@playwright/test";

/**
 * The canonical parity snapshot.
 *
 * It is read **out of IndexedDB, through the storage service's own database and
 * store names** — `video-editor-projects/projects` and
 * `video-editor-media-<projectId>/media-metadata` — not through a purpose-built
 * export path. An export path would be code written for the comparison, and
 * would prove that the export works rather than that the two hosts persist the
 * same project.
 *
 * Normalization is deliberately narrow. Ids become ordinals by first appearance
 * and timestamps and data-URL payloads become placeholders, because those are
 * generated per run and differ for reasons that have nothing to do with editing.
 * **Track membership, clip ordering, `startTime`, `duration`, `trimStart` and
 * `trimEnd` are never touched** — they are exactly what the diff exists to
 * compare, and normalizing a difference away there would fabricate a pass.
 */
export interface RawSnapshot {
	project: unknown;
	media: unknown[];
	databases: { name: string; stores: { store: string; rows: number }[] }[];
}

export interface ParitySnapshot {
	project: unknown;
	media: unknown[];
	trackSummary: {
		visualTracks: number;
		audioTracks: number;
		tracks: { kind: string; name: string; elements: string[] }[];
	};
	/** Recorded, not compared: what the placeholders stood in for. */
	normalizationLedger: {
		idOrdinals: number;
		timestampsReplaced: number;
		dataUrlsReplaced: { path: string; mime: string; chars: number }[];
	};
}

const PROJECTS_DB = "video-editor-projects";
const PROJECTS_STORE = "projects";
const MEDIA_DB_PREFIX = "video-editor-media-";
const MEDIA_STORE = "media-metadata";

export async function readPersisted(page: Page): Promise<RawSnapshot> {
	return page.evaluate(
		async ({ projectsDb, projectsStore, mediaPrefix, mediaStore }) => {
			const open = (name: string): Promise<IDBDatabase> =>
				new Promise((resolve, reject) => {
					const request = indexedDB.open(name);
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
			const getAll = (db: IDBDatabase, store: string): Promise<unknown[]> =>
				new Promise((resolve) => {
					if (!db.objectStoreNames.contains(store)) {
						resolve([]);
						return;
					}
					const request = db
						.transaction(store, "readonly")
						.objectStore(store)
						.getAll();
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => resolve([]);
				});

			const projectsDatabase = await open(projectsDb);
			const projects = await getAll(projectsDatabase, projectsStore);
			projectsDatabase.close();

			const project = projects[0] ?? null;
			const projectId =
				project && typeof project === "object"
					? ((project as { id?: string }).id ?? null)
					: null;

			let media: unknown[] = [];
			if (projectId) {
				const mediaDatabase = await open(`${mediaPrefix}${projectId}`);
				media = await getAll(mediaDatabase, mediaStore);
				mediaDatabase.close();
			}

			// Recorded so the snapshot can say what it did *not* read, rather than
			// implying the project record is everything the app persisted.
			const databases: {
				name: string;
				stores: { store: string; rows: number }[];
			}[] = [];
			for (const info of await indexedDB.databases()) {
				if (!info.name) continue;
				const db = await open(info.name);
				const stores: { store: string; rows: number }[] = [];
				for (const store of [...db.objectStoreNames]) {
					stores.push({ store, rows: (await getAll(db, store)).length });
				}
				db.close();
				databases.push({ name: info.name, stores });
			}

			return { project, media, databases };
		},
		{
			projectsDb: PROJECTS_DB,
			projectsStore: PROJECTS_STORE,
			mediaPrefix: MEDIA_DB_PREFIX,
			mediaStore: MEDIA_STORE,
		},
	);
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;
const ID_KEYS = new Set([
	"id",
	"trackId",
	"elementId",
	"mediaId",
	"sceneId",
	"projectId",
]);
const TIME_KEYS = new Set([
	"createdAt",
	"updatedAt",
	"lastModified",
	"timestamp",
]);

export function normalize(raw: RawSnapshot): ParitySnapshot {
	const ids = new Map<string, string>();
	const dataUrls: { path: string; mime: string; chars: number }[] = [];
	let timestamps = 0;

	const ordinal = (value: string): string => {
		const existing = ids.get(value);
		if (existing) return existing;
		const assigned = `<id:${ids.size + 1}>`;
		ids.set(value, assigned);
		return assigned;
	};

	const walk = (value: unknown, key: string, path: string): unknown => {
		if (typeof value === "string") {
			if (value.startsWith("data:")) {
				const mime = value.slice(5, value.indexOf(";")) || "unknown";
				dataUrls.push({ path, mime, chars: value.length });
				return `<data-url:${mime}>`;
			}
			// `blob:` is deliberately NOT normalized. Task 8.3 established that no
			// persisted string carries one; if one ever appears, the diff should
			// show it rather than swallow it.
			if (ID_KEYS.has(key) || UUID_RE.test(value)) return ordinal(value);
			if (TIME_KEYS.has(key) || ISO_DATE_RE.test(value)) {
				timestamps += 1;
				return "<timestamp>";
			}
			return value;
		}
		if (typeof value === "number" && TIME_KEYS.has(key)) {
			timestamps += 1;
			return "<timestamp>";
		}
		if (Array.isArray(value)) {
			// Order is preserved: clip ordering is semantics, not noise.
			return value.map((entry, index) => walk(entry, key, `${path}[${index}]`));
		}
		if (value && typeof value === "object") {
			const out: Record<string, unknown> = {};
			// Sorted keys so the comparison cannot fail on insertion order, which
			// carries no meaning. Ordinal assignment follows this same order, so it
			// is deterministic across hosts.
			for (const entryKey of Object.keys(
				value as Record<string, unknown>,
			).sort()) {
				out[entryKey] = walk(
					(value as Record<string, unknown>)[entryKey],
					entryKey,
					`${path}.${entryKey}`,
				);
			}
			return out;
		}
		return value;
	};

	const project = walk(raw.project, "project", "project");
	// Media records are sorted by name before comparison. `media-metadata` is a
	// key-value store keyed by a random id, so `getAll` returns records in an
	// order that differs between two runs of the *same* host — it is not project
	// content and carries no editing meaning. Every record's own fields are still
	// compared in full; only the array order is stabilised.
	const media = [...raw.media]
		.sort((a, b) =>
			String((a as { name?: string }).name ?? "").localeCompare(
				String((b as { name?: string }).name ?? ""),
			),
		)
		.map((entry, index) => walk(entry, "media", `media[${index}]`));

	return {
		project,
		media: media as unknown[],
		trackSummary: summarizeTracks(raw.project),
		normalizationLedger: {
			idOrdinals: ids.size,
			timestampsReplaced: timestamps,
			dataUrlsReplaced: dataUrls,
		},
	};
}

interface TrackLike {
	name?: string;
	type?: string;
	elements?: { name?: string; startTime?: number; duration?: number }[];
}

/**
 * A human-readable view of the same data, so a reviewer can see "two visual
 * tracks, two audio tracks, these clips in this order" without reading the raw
 * record. Derived from the raw project, never from the normalized copy.
 */
export function summarizeTracks(project: unknown): ParitySnapshot["trackSummary"] {
	const scenes =
		(project as { scenes?: { tracks?: Record<string, unknown> }[] })?.scenes ??
		[];
	const tracks: { kind: string; name: string; elements: string[] }[] = [];
	let visualTracks = 0;
	let audioTracks = 0;

	for (const scene of scenes) {
		const sceneTracks = scene.tracks as
			| { main?: TrackLike; overlay?: TrackLike[]; audio?: TrackLike[] }
			| undefined;
		if (!sceneTracks) continue;
		const describe = (kind: string, track: TrackLike | undefined) => {
			if (!track) return;
			tracks.push({
				kind,
				name: track.name ?? "",
				elements: (track.elements ?? []).map(
					(element) =>
						`${element.name ?? "?"}@${element.startTime ?? "?"}+${element.duration ?? "?"}`,
				),
			});
			if (kind === "audio") audioTracks += 1;
			else visualTracks += 1;
		};
		describe(`main:${sceneTracks.main?.type ?? "?"}`, sceneTracks.main);
		for (const track of sceneTracks.overlay ?? [])
			describe(`overlay:${track.type ?? "?"}`, track);
		for (const track of sceneTracks.audio ?? []) describe("audio", track);
	}

	return { visualTracks, audioTracks, tracks };
}
