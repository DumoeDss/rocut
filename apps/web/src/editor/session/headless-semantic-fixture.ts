/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The fixture deliberately verifies opaque provider-owned values. */
import {
	InMemoryProjectStore,
	type InMemoryRuntimeResourceHost,
} from "@/editor/ports/in-memory";
import { createInMemoryHost } from "@/editor/ports/in-memory/host";
import { createHeadlessEditorSession } from "./headless";
import type {
	HeadlessRuntimeProbeController,
	HeadlessRuntimeProbeSnapshot,
} from "./headless-runtime-probe";

const PROJECT_ID = "c7-headless-project";
const SEEDED_NAME = "C7 seeded project";
const EDITED_NAME = "C7 headless edit";
const SEEDED_AT = "2026-08-05T01:00:00.000Z";
const EDITED_AT = "2026-08-05T02:00:00.000Z";
const ATTACHMENT_KEY = "provider-attachment.bin";

type Raw = Record<string, unknown>;

export interface HeadlessSemanticResult {
	readonly schemaVersion: 1;
	readonly host: "node" | "vite" | "next";
	readonly buildMarker: string;
	readonly acceptedHead: string;
	readonly acceptedTree: string;
	readonly entry: string;
	readonly storeIdentity: string;
	readonly storeRunIdentity: string;
	readonly hostFallback: boolean;
	readonly projectId: string;
	readonly firstOwnerId: string;
	readonly secondOwnerId: string;
	readonly ownersDistinct: boolean;
	readonly seededName: string;
	readonly editedName: string;
	readonly reopenedName: string | null;
	readonly seededUpdatedAt: string;
	readonly editedUpdatedAt: string;
	readonly reopenedUpdatedAt: string | null;
	readonly seededProjectDigest: string;
	readonly firstLoadDigest: string;
	readonly savedProjectDigest: string;
	readonly reopenedProjectDigest: string;
	readonly reopenedLoadDigest: string;
	readonly seededOpaqueDigest: string;
	readonly reopenedOpaqueDigest: string;
	readonly opaquePreserved: boolean;
	readonly attachmentKey: string;
	readonly attachmentSchemaVersion: number;
	readonly seededAttachmentDigest: string;
	readonly reopenedAttachmentDigest: string;
	readonly seededAttachmentMetadataDigest: string;
	readonly reopenedAttachmentMetadataDigest: string;
	readonly attachmentPreserved: boolean;
	readonly durableProjectPresent: boolean;
	readonly durableAttachmentPresent: boolean;
	readonly firstDisposal: "fulfilled" | "rejected";
	readonly secondDisposal: "fulfilled" | "rejected";
	readonly postDisposeWriteRejected: boolean;
	readonly postDisposeStoreUntouched: boolean;
	readonly reactMountAttempts: number;
	readonly navigationAttempts: number;
	readonly runtimeResourceCounts: {
		readonly timers: number;
		readonly animationFrames: number;
		readonly workers: number;
		readonly audioContexts: number;
		readonly objectUrls: number;
		readonly compositorGpuOwners: number;
	};
	readonly runtimeProbe: HeadlessRuntimeProbeSnapshot;
	readonly errors: readonly string[];
}

function rawProject(): Raw {
	return {
		metadata: {
			id: PROJECT_ID,
			name: SEEDED_NAME,
			duration: 0,
			createdAt: SEEDED_AT,
			updatedAt: SEEDED_AT,
			providerPrivateMetadata: {
				nested: ["retain", { value: 17 }],
			},
		},
		scenes: [
			{
				id: "main-scene",
				name: "Main",
				isMain: true,
				tracks: {
					overlay: [],
					main: {
						id: "main-track",
						name: "Main",
						type: "video",
						muted: false,
						hidden: false,
						elements: [],
					},
					audio: [],
				},
				bookmarks: [],
				createdAt: SEEDED_AT,
				updatedAt: SEEDED_AT,
			},
		],
		currentSceneId: "main-scene",
		settings: {
			fps: { numerator: 30, denominator: 1 },
			canvasSize: { width: 1920, height: 1080 },
			background: { type: "color", color: "#000000" },
		},
		version: 31,
		providerPrivateProject: {
			map: new Map([["provider", "retained"]]),
			set: new Set(["alpha", "beta"]),
			bytes: new Uint8Array([3, 1, 4, 1, 5]),
		},
	};
}

function canonical(value: unknown): unknown {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (value === undefined) return { $type: "undefined" };
	if (value instanceof Date) {
		return { $type: "date", value: value.toISOString() };
	}
	if (value instanceof ArrayBuffer) {
		return { $type: "bytes", value: [...new Uint8Array(value)] };
	}
	if (ArrayBuffer.isView(value)) {
		return {
			$type: "bytes",
			value: [
				...new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
			],
		};
	}
	if (value instanceof Map) {
		return {
			$type: "map",
			value: [...value.entries()]
				.map(([key, entry]) => [canonical(key), canonical(entry)])
				.sort(([left], [right]) =>
					JSON.stringify(left).localeCompare(JSON.stringify(right)),
				),
		};
	}
	if (value instanceof Set) {
		return {
			$type: "set",
			value: [...value]
				.map(canonical)
				.sort((left, right) =>
					JSON.stringify(left).localeCompare(JSON.stringify(right)),
				),
		};
	}
	if (Array.isArray(value)) return value.map(canonical);
	if (typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, canonical(entry)]),
		);
	}
	throw new Error(`Cannot canonicalize ${typeof value}`);
}

async function digest(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
	const hashed = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(hashed)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function opaqueValue(record: Raw): unknown {
	return {
		project: record.providerPrivateProject,
		metadata: (record.metadata as Raw).providerPrivateMetadata,
	};
}

async function settleDisposal(args: {
	label: string;
	dispose: () => Promise<void>;
	errors: string[];
}): Promise<"fulfilled" | "rejected"> {
	try {
		await args.dispose();
		return "fulfilled";
	} catch (error) {
		args.errors.push(
			`${args.label}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return "rejected";
	}
}

export async function runHeadlessSemanticFixture(args: {
	host: "node" | "vite" | "next";
	buildMarker: string;
	acceptedHead: string;
	acceptedTree: string;
	entry: string;
	runtimeProbe: HeadlessRuntimeProbeController;
	runtimeSensitivityControl?: (args: {
		host: ReturnType<typeof createInMemoryHost>;
	}) => Promise<void>;
}): Promise<HeadlessSemanticResult> {
	const store = new InMemoryProjectStore();
	const seededData = rawProject();
	const attachmentBody = new Uint8Array([0, 1, 1, 2, 3, 5, 8, 13]).buffer;
	const attachmentMetadata = {
		schemaVersion: 7,
		contentType: "application/octet-stream",
		providerPrivateAttachment: { nested: ["unchanged", 23] },
	};
	await store.save({
		record: { id: PROJECT_ID, schemaVersion: 31, data: seededData },
		summary: {
			id: PROJECT_ID,
			name: SEEDED_NAME,
			createdAt: SEEDED_AT,
			updatedAt: SEEDED_AT,
		},
	});
	await store.saveAttachment({
		projectId: PROJECT_ID,
		key: ATTACHMENT_KEY,
		metadata: attachmentMetadata,
		body: attachmentBody,
	});

	let navigationAttempts = 0;
	const host = createInMemoryHost({ projectId: PROJECT_ID, store });
	const intendedStoreIdentity =
		store instanceof InMemoryProjectStore
			? "InMemoryProjectStore"
			: "unexpected-store";
	const hostBinding = args.runtimeProbe.bindHost({
		host,
		intendedStore: store,
		intendedStoreIdentity,
		expectedProjectId: PROJECT_ID,
	});
	host.navigation.onProjectReplaced = () => {
		navigationAttempts += 1;
	};
	host.navigation.onExitProject = () => {
		navigationAttempts += 1;
	};
	host.navigation.onGoBack = () => {
		navigationAttempts += 1;
	};
	const runtime = host.runtimeResources as InMemoryRuntimeResourceHost;
	const errors: string[] = [];
	if (args.runtimeSensitivityControl) {
		await args.runtimeSensitivityControl({ host });
	}
	const seededRecord = await store.load({ id: PROJECT_ID });
	if (!seededRecord) throw new Error("C7 seeded project record is absent");
	const seededAttachment = await store.loadAttachment({
		projectId: PROJECT_ID,
		key: ATTACHMENT_KEY,
	});
	if (!seededAttachment) throw new Error("C7 seeded attachment is absent");

	const first = await createHeadlessEditorSession({ host });
	const loaded = await first.load();
	if (!loaded) throw new Error("C7 first headless owner loaded null");
	const firstLoadDigest = await digest(loaded);
	loaded.metadata.name = EDITED_NAME;
	loaded.metadata.updatedAt = new Date(EDITED_AT);
	await first.save({ project: loaded });
	const savedRecord = await store.load({ id: PROJECT_ID });
	if (!savedRecord) throw new Error("C7 saved project record disappeared");
	const firstDisposal = await settleDisposal({
		label: "first disposal",
		dispose: first.dispose,
		errors,
	});
	let postDisposeWriteRejected = false;
	loaded.metadata.name = "post-dispose write must not persist";
	try {
		await first.save({ project: loaded });
	} catch {
		postDisposeWriteRejected = true;
	}
	const afterPostDisposeAttempt = await store.load({ id: PROJECT_ID });

	const second = await createHeadlessEditorSession({ host });
	const reopened = await second.load();
	if (!reopened) throw new Error("C7 second headless owner loaded null");
	const reopenedLoadDigest = await digest(reopened);
	const secondDisposal = await settleDisposal({
		label: "second disposal",
		dispose: second.dispose,
		errors,
	});

	const reopenedRecord = await store.load({ id: PROJECT_ID });
	const reopenedAttachment = await store.loadAttachment({
		projectId: PROJECT_ID,
		key: ATTACHMENT_KEY,
	});
	const seededProjectDigest = await digest(seededRecord.data);
	const savedProjectDigest = await digest(savedRecord.data);
	const afterPostDisposeProjectDigest = await digest(
		afterPostDisposeAttempt?.data,
	);
	const reopenedProjectDigest = await digest(reopenedRecord?.data);
	const seededOpaqueDigest = await digest(
		opaqueValue(seededRecord.data as Raw),
	);
	const reopenedOpaqueDigest = await digest(
		reopenedRecord ? opaqueValue(reopenedRecord.data as Raw) : null,
	);
	const seededAttachmentDigest = await digest(seededAttachment.body);
	const reopenedAttachmentDigest = await digest(reopenedAttachment?.body);
	const seededAttachmentMetadataDigest = await digest(
		seededAttachment.metadata,
	);
	const reopenedAttachmentMetadataDigest = await digest(
		reopenedAttachment?.metadata,
	);
	args.runtimeProbe.recordHostResourceState({
		workers: runtime.workers.length,
		audioContexts: runtime.audioContexts.length,
		objectUrls: runtime.objectUrls.length,
	});
	const runtimeProbe = args.runtimeProbe.finish();

	return {
		schemaVersion: 1,
		host: args.host,
		buildMarker: args.buildMarker,
		acceptedHead: args.acceptedHead,
		acceptedTree: args.acceptedTree,
		entry: args.entry,
		storeIdentity: hostBinding.actualStoreIdentity,
		storeRunIdentity: `${args.host}:${args.buildMarker}:InMemoryProjectStore:${PROJECT_ID}`,
		hostFallback: hostBinding.fallbackUsed,
		projectId: PROJECT_ID,
		firstOwnerId: first.id,
		secondOwnerId: second.id,
		ownersDistinct: first.id !== second.id,
		seededName: SEEDED_NAME,
		editedName: EDITED_NAME,
		reopenedName: reopened.metadata.name,
		seededUpdatedAt: SEEDED_AT,
		editedUpdatedAt: EDITED_AT,
		reopenedUpdatedAt: reopened.metadata.updatedAt.toISOString(),
		seededProjectDigest,
		firstLoadDigest,
		savedProjectDigest,
		reopenedProjectDigest,
		reopenedLoadDigest,
		seededOpaqueDigest,
		reopenedOpaqueDigest,
		opaquePreserved: seededOpaqueDigest === reopenedOpaqueDigest,
		attachmentKey: ATTACHMENT_KEY,
		attachmentSchemaVersion: 7,
		seededAttachmentDigest,
		reopenedAttachmentDigest,
		seededAttachmentMetadataDigest,
		reopenedAttachmentMetadataDigest,
		attachmentPreserved:
			seededAttachmentDigest === reopenedAttachmentDigest &&
			seededAttachmentMetadataDigest === reopenedAttachmentMetadataDigest,
		durableProjectPresent: reopenedRecord !== null,
		durableAttachmentPresent: reopenedAttachment !== null,
		firstDisposal,
		secondDisposal,
		postDisposeWriteRejected,
		postDisposeStoreUntouched:
			afterPostDisposeProjectDigest === savedProjectDigest,
		reactMountAttempts: runtimeProbe.react.mountAttempts,
		navigationAttempts,
		runtimeResourceCounts: {
			timers:
				runtimeProbe.globalCalls.timeouts + runtimeProbe.globalCalls.intervals,
			animationFrames: runtimeProbe.globalCalls.animationFrames,
			workers:
				runtimeProbe.globalCalls.workers + runtimeProbe.hostCalls.workers,
			audioContexts:
				runtimeProbe.globalCalls.audioContexts +
				runtimeProbe.hostCalls.audioContexts,
			objectUrls:
				runtimeProbe.globalCalls.objectUrls + runtimeProbe.hostCalls.objectUrls,
			compositorGpuOwners: runtimeProbe.compositorGpu.ownershipAttempts,
		},
		runtimeProbe,
		errors,
	};
}
