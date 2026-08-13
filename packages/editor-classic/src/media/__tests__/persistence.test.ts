import { describe, expect, test } from "bun:test";
import { SessionPersistenceCoordinator } from "../../editor/persistence";
import {
	InMemoryProjectStore,
	InMemoryRuntimeResourceHost,
} from "@opencut/editor-ports/in-memory";
import { createInMemoryHost } from "@opencut/editor-ports/in-memory/host";
import { UNIMPLEMENTED_RUNTIME_GPU } from "@opencut/editor-ports";
import { createSessionResources } from "../../editor/session/session-resources";
import {
	decodePersistedMediaMetadata,
	mediaAssetFromAttachment,
	savePersistedMediaAsset,
} from "../persistence";

describe("session-owned media persistence", () => {
	test("legacy SVG replacement revokes the sniff URL once and retains the replacement handle", async () => {
		const runtimeResources = new InMemoryRuntimeResourceHost();
		const objectUrls = runtimeResources.objectUrls;
		let sequence = 0;
		const resources = createSessionResources({
			runtimeResources,
			runtimeGpu: UNIMPLEMENTED_RUNTIME_GPU,
			nextId: ({ scope }) => `${scope}-${++sequence}`,
		});
		const asset = await mediaAssetFromAttachment({
			attachment: {
				projectId: "svg-project",
				key: "legacy-svg",
				metadata: {
					id: "legacy-svg",
					name: "legacy.svg",
					type: "image",
					mimeType: "",
					lastModified: 1,
				},
				body: new TextEncoder().encode("<svg viewBox='0 0 1 1'></svg>").buffer,
			},
			resources,
		});

		expect(objectUrls).toHaveLength(2);
		expect(objectUrls[0]?.revoked).toBe(true);
		expect(objectUrls[1]?.revoked).toBe(false);
		expect(asset.url).toBe(objectUrls[1]?.url);
		expect(asset.urlHandle).toBeDefined();

		await resources.disposeAll();
		expect(objectUrls[0]?.revoked).toBe(true);
		expect(objectUrls[1]?.revoked).toBe(true);
	});

	test("round-trips attachment bytes and metadata with project isolation", async () => {
		const store = new InMemoryProjectStore();
		const host = createInMemoryHost();
		const resources = createSessionResources({
			runtimeResources: host.runtimeResources,
			runtimeGpu: UNIMPLEMENTED_RUNTIME_GPU,
			nextId: ({ scope }) => scope,
		});
		const persistence = new SessionPersistenceCoordinator(store);
		const fileA = new File([new Uint8Array([1, 2, 3])], "clip-a.mp4", {
			type: "video/mp4",
			lastModified: 11,
		});
		const fileB = new File([new Uint8Array([9, 8])], "clip-b.mp4", {
			type: "video/mp4",
			lastModified: 22,
		});

		await savePersistedMediaAsset({
			persistence,
			projectId: "project-a",
			asset: {
				id: "shared",
				name: fileA.name,
				type: "video",
				file: fileA,
				fps: 60,
				hasAudio: true,
			},
		});
		await savePersistedMediaAsset({
			persistence,
			projectId: "project-b",
			asset: {
				id: "shared",
				name: fileB.name,
				type: "video",
				file: fileB,
			},
		});

		const [attachmentA] = await persistence.listAttachments({
			projectId: "project-a",
			decodeMetadata: decodePersistedMediaMetadata,
		});
		const loadedA = await mediaAssetFromAttachment({
			attachment: attachmentA,
			resources,
		});
		const loadedB = await store.loadAttachment({
			projectId: "project-b",
			key: "shared",
		});

		expect([...new Uint8Array(await loadedA.file.arrayBuffer())]).toEqual([
			1, 2, 3,
		]);
		expect(loadedA).toMatchObject({
			id: "shared",
			name: "clip-a.mp4",
			fps: 60,
			hasAudio: true,
		});
		expect([...new Uint8Array(loadedB!.body)]).toEqual([9, 8]);
		await resources.disposeAll();
	});

	test("retains private attachment metadata after a known update", async () => {
		const store = new InMemoryProjectStore();
		await store.saveAttachment({
			projectId: "project",
			key: "media",
			metadata: {
				id: "media",
				name: "media.wav",
				type: "audio",
				mimeType: "audio/wav",
				lastModified: 1,
				duration: 1,
				providerPrivate: { keep: true },
			},
			body: new Uint8Array([4, 5]).buffer,
		});
		const persistence = new SessionPersistenceCoordinator(store);
		const loaded = await persistence.loadAttachment({
			projectId: "project",
			key: "media",
			decodeMetadata: decodePersistedMediaMetadata,
		});
		await persistence.saveAttachment({
			projectId: "project",
			key: "media",
			metadata: { ...loaded!.metadata, duration: 2 },
			body: loaded!.body,
		});

		expect(
			await store.loadAttachment({ projectId: "project", key: "media" }),
		).toMatchObject({
			metadata: {
				duration: 2,
				providerPrivate: { keep: true },
			},
		});
	});

	test("orders removal after a still-reading attachment write", async () => {
		const store = new InMemoryProjectStore();
		const persistence = new SessionPersistenceCoordinator(store);
		let releaseBody!: (body: ArrayBuffer) => void;
		const body = new Promise<ArrayBuffer>((resolve) => {
			releaseBody = resolve;
		});
		const save = persistence.saveAttachment({
			projectId: "project",
			key: "media",
			metadata: { revision: 1 },
			body,
		});
		const remove = persistence.removeAttachment({
			projectId: "project",
			key: "media",
		});
		releaseBody(new Uint8Array([1]).buffer);

		await Promise.all([save, remove]);
		expect(
			await store.loadAttachment({ projectId: "project", key: "media" }),
		).toBeNull();
	});
});
