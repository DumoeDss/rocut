/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- This codec is the runtime validation/narrowing boundary for Host-supplied opaque project data; compact parsing helpers keep field paths legible. */
import type { TProject } from "../../project/types";
import type {
	SceneTracks,
	TimelineElement,
	TimelineTrack,
	TScene,
} from "../../timeline/types";
import { cloneOpaque, overlayOpaque } from "./opaque-value";
import { EDITING_NAME_SHAPE_KEY } from "./editing-name-shape";
import { assertTrackLockRuntime } from "../transactions/opencut/track-lock-runtime";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`Invalid persisted project: ${label} must be an object`);
	}
	return value as UnknownRecord;
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`Invalid persisted project: ${label} must be a string`);
	}
	return value;
}

function date(value: unknown, label: string): Date {
	const parsed =
		value instanceof Date ? new Date(value) : new Date(text(value, label));
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`Invalid persisted project: ${label} is not a date`);
	}
	return parsed;
}

function pick(source: UnknownRecord, keys: readonly string[]): UnknownRecord {
	const result: UnknownRecord = {};
	for (const key of keys) {
		if (Object.hasOwn(source, key)) result[key] = cloneOpaque(source[key]);
	}
	return result;
}

const TRACK_KEYS = [
	"id",
	"name",
	"type",
	"elements",
	"muted",
	"hidden",
	"locked",
];
const ELEMENT_KEYS = [
	EDITING_NAME_SHAPE_KEY,
	"id",
	"name",
	"type",
	"duration",
	"startTime",
	"trimStart",
	"trimEnd",
	"sourceDuration",
	"animations",
	"params",
	"retime",
	"sourceType",
	"mediaId",
	"sourceUrl",
	"isSourceAudioEnabled",
	"freezeFrame",
	"transitionIn",
	"adjustment",
	"hidden",
	"effects",
	"masks",
	"stickerId",
	"intrinsicWidth",
	"intrinsicHeight",
	"definitionId",
	"programmatic",
	"sequenceId",
	"effectType",
] as const;

function decodeElement(value: unknown): TimelineElement {
	return pick(
		record(value, "timeline element"),
		ELEMENT_KEYS,
	) as unknown as TimelineElement;
}

function decodeTrack(value: unknown): TimelineTrack {
	const raw = record(value, "track");
	if (raw.locked !== undefined && typeof raw.locked !== "boolean")
		throw new Error("Invalid track lock state");
	if (raw.locked === true) assertTrackLockRuntime();
	return {
		...pick(raw, TRACK_KEYS),
		elements: Array.isArray(raw.elements)
			? raw.elements.map(decodeElement)
			: [],
	} as unknown as TimelineTrack;
}

function decodeTracks(value: unknown): SceneTracks {
	const raw = record(value, "scene tracks");
	return {
		overlay: Array.isArray(raw.overlay) ? raw.overlay.map(decodeTrack) : [],
		main: decodeTrack(raw.main),
		audio: Array.isArray(raw.audio) ? raw.audio.map(decodeTrack) : [],
	} as SceneTracks;
}

function decodeScene(value: unknown): TScene {
	const raw = record(value, "scene");
	return {
		...pick(raw, ["id", "name", "isMain", "bookmarks"]),
		id: text(raw.id, "scene.id"),
		name: text(raw.name, "scene.name"),
		isMain: raw.isMain === true,
		tracks: decodeTracks(raw.tracks),
		bookmarks: Array.isArray(raw.bookmarks) ? cloneOpaque(raw.bookmarks) : [],
		createdAt: date(raw.createdAt, "scene.createdAt"),
		updatedAt: date(raw.updatedAt, "scene.updatedAt"),
	} as TScene;
}

/**
 * Decode into detached fields by default; provider-private siblings stay retained.
 * Borrowing is internal-only: the backing record must remain private and immutable,
 * and the result must be detached before exposing it outside its owner.
 */
export function decodeProject(
	data: unknown,
	options?: { sequenceOwnership: "borrow" },
): TProject {
	const raw = record(data, "project");
	if (
		typeof raw.__opencutTransaction === "object" &&
		raw.__opencutTransaction !== null &&
		Reflect.get(raw.__opencutTransaction, "version") === 2
	)
		assertTrackLockRuntime();
	const metadata = record(raw.metadata, "project.metadata");
	if (!Array.isArray(raw.scenes)) {
		throw new Error("Invalid persisted project: scenes must be an array");
	}
	return {
		metadata: {
			...pick(metadata, ["name", "thumbnail"]),
			id: text(metadata.id, "metadata.id"),
			name: text(metadata.name, "metadata.name"),
			duration: cloneOpaque(
				metadata.duration,
			) as TProject["metadata"]["duration"],
			createdAt: date(metadata.createdAt, "metadata.createdAt"),
			updatedAt: date(metadata.updatedAt, "metadata.updatedAt"),
		},
		scenes: raw.scenes.map(decodeScene),
		motionTextSequences: Array.isArray(raw.motionTextSequences)
			? options?.sequenceOwnership === "borrow"
				? raw.motionTextSequences
				: cloneOpaque(raw.motionTextSequences)
			: [],
		currentSceneId: text(raw.currentSceneId, "currentSceneId"),
		...(raw.musicGridState !== undefined && {
			musicGridState: cloneOpaque(
				raw.musicGridState,
			) as TProject["musicGridState"],
		}),
		...(raw.mediaFolders !== undefined && {
			mediaFolders: cloneOpaque(raw.mediaFolders) as TProject["mediaFolders"],
		}),
		settings: cloneOpaque(raw.settings) as TProject["settings"],
		version: cloneOpaque(raw.version) as number,
		...(Object.hasOwn(raw, "timelineViewState") && {
			timelineViewState: cloneOpaque(
				raw.timelineViewState,
			) as TProject["timelineViewState"],
		}),
	};
}

function encodeElement(element: TimelineElement): UnknownRecord {
	const source = element as unknown as UnknownRecord;
	return Object.fromEntries(
		ELEMENT_KEYS.map((key) => [key, cloneOpaque(source[key])]),
	);
}

function encodeTrack(track: TimelineTrack): UnknownRecord {
	const source = track as unknown as UnknownRecord;
	return {
		...Object.fromEntries(
			TRACK_KEYS.map((key) => [
				key,
				key === "elements" ? undefined : cloneOpaque(source[key]),
			]),
		),
		elements: track.elements.map(encodeElement),
	};
}

function encodeTracks(tracks: SceneTracks): UnknownRecord {
	return {
		overlay: tracks.overlay.map(encodeTrack),
		main: encodeTrack(tracks.main),
		audio: tracks.audio.map(encodeTrack),
	};
}

function encodeScene(scene: TScene): UnknownRecord {
	return {
		id: scene.id,
		name: scene.name,
		isMain: scene.isMain,
		tracks: encodeTracks(scene.tracks),
		bookmarks: cloneOpaque(scene.bookmarks),
		createdAt: scene.createdAt.toISOString(),
		updatedAt: scene.updatedAt.toISOString(),
	};
}

export function encodeProject({
	project,
	retained,
}: {
	project: TProject;
	retained: unknown;
}): unknown {
	const known = {
		metadata: {
			id: project.metadata.id,
			name: project.metadata.name,
			thumbnail: project.metadata.thumbnail,
			duration: project.metadata.duration,
			createdAt: project.metadata.createdAt.toISOString(),
			updatedAt: project.metadata.updatedAt.toISOString(),
		},
		scenes: project.scenes.map(encodeScene),
		// These entities are replaced below, not recursively overlaid. Do not
		// clone/traverse the full sequence tree only to discard that result.
		motionTextSequences: [] as TProject["motionTextSequences"],
		mediaFolders: undefined as TProject["mediaFolders"],
		musicGridState: undefined as TProject["musicGridState"],
		currentSceneId: project.currentSceneId,
		settings: cloneOpaque(project.settings),
		version: project.version,
		timelineViewState: cloneOpaque(project.timelineViewState),
	};
	const encoded = overlayOpaque({ retained, known });
	if (
		project.scenes.some((scene) =>
			[...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio].some(
				(track) => track.locked === true,
			),
		)
	) {
		assertTrackLockRuntime();
		const envelope: unknown = Reflect.get(encoded, "__opencutTransaction");
		Reflect.set(encoded, "__opencutTransaction", {
			...(typeof envelope === "object" && envelope !== null
				? envelope
				: { revision: 0, idempotency: [], assetCatalog: [] }),
			version: 2,
		});
	}
	// A motion-text update is a full entity replacement. The decoded entity
	// already carries opaque extensions, so merging it with an older persisted
	// entity would incorrectly resurrect removed optional fields (for example a
	// resolved plan after undo, or inherited cue overrides).
	encoded.motionTextSequences = cloneOpaque(project.motionTextSequences);
	encoded.mediaFolders = cloneOpaque(project.mediaFolders);
	encoded.musicGridState = cloneOpaque(project.musicGridState);
	// These objects are complete editor-owned values, not opaque partial patches.
	// Recursive overlay would resurrect deleted animation channels/parameters or
	// retain the other background variant after switching color <-> blur.
	encoded.settings.background = cloneOpaque(project.settings.background);
	// Ordered complete replacement: removing an effect/parameter must not restore
	// a retained provider value. Legacy records without the field remain valid.
	encoded.settings.masterEffects = cloneOpaque(project.settings.masterEffects);
	for (const [sceneIndex, scene] of project.scenes.entries()) {
		const savedTracks = record(
			encoded.scenes[sceneIndex].tracks,
			"encoded tracks",
		);
		const nativeTracks = [
			...scene.tracks.overlay,
			scene.tracks.main,
			...scene.tracks.audio,
		];
		const saved = [
			...(savedTracks.overlay as UnknownRecord[]),
			record(savedTracks.main, "encoded main track"),
			...(savedTracks.audio as UnknownRecord[]),
		];
		for (const [trackIndex, track] of nativeTracks.entries()) {
			const elements = saved[trackIndex].elements as UnknownRecord[];
			for (const [elementIndex, element] of track.elements.entries()) {
				const source = element as unknown as UnknownRecord;
				for (const key of [
					EDITING_NAME_SHAPE_KEY,
					"params",
					"animations",
					"effects",
					"masks",
					"programmatic",
				]) {
					elements[elementIndex][key] = cloneOpaque(source[key]);
				}
			}
		}
	}
	return encoded;
}
