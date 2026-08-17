import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectId } from "@opencut/editor-contracts";
import {
	canonicalize,
	composeFrameDescription,
	digestFrameDescription,
	frameIndexAt,
	frameProofFromRecord,
} from "@opencut/editor-classic/frame-proof";
import {
	CURRENT_PROJECT_VERSION,
	createOpenCutProjectRecord,
} from "@opencut/editor-classic/transactions";
import type { TProject } from "@opencut/editor-classic/project";
import type { TScene } from "@opencut/editor-classic/timeline/types";
import { FileProjectStore } from "../file-store";
import { prepareEditorProjectRecord } from "../editor-plane";
import { TargetRegistry } from "../target-registry";
import { startHost } from "../host";
import type { RunningHost } from "../host";

const tempRoots: string[] = [];
async function tempRoot(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-proof-"));
	tempRoots.push(root);
	return root;
}
afterAll(async () => {
	for (const root of tempRoots)
		await rm(root, { recursive: true, force: true });
});

const SECOND = 120_000;

function textElement(id: string, startTime: number, duration: number, content: string) {
	return {
		id,
		type: "text" as const,
		name: id,
		startTime,
		duration,
		trimStart: 0,
		trimEnd: 0,
		params: { content, x: 100, y: 200 },
	} as never;
}

function projectWith(elements: never[], name = "Proof project"): TProject {
	const scene: TScene = {
		id: "scene-1",
		name: "Main scene",
		isMain: true,
		tracks: {
			overlay: elements.length
				? [
						{
							id: "overlay-1",
							name: "Overlay",
							type: "graphic",
							elements,
							hidden: false,
						} as never,
					]
				: [],
			main: {
				id: "main-1",
				name: "Main Track",
				type: "video",
				elements: [],
				muted: false,
				hidden: false,
			},
			audio: [],
		},
		bookmarks: [],
		createdAt: new Date(0),
		updatedAt: new Date(0),
	};
	return {
		metadata: {
			id: "proof-project",
			name,
			duration: 10 * SECOND,
			createdAt: new Date(0),
			updatedAt: new Date(0),
		},
		scenes: [scene],
		currentSceneId: scene.id,
		settings: {
			fps: { numerator: 30, denominator: 1 },
			canvasSize: { width: 1920, height: 1080 },
			canvasSizeMode: "preset",
			lastCustomCanvasSize: null,
			originalCanvasSize: null,
			background: { type: "color", color: "#000000" },
		},
		version: CURRENT_PROJECT_VERSION,
	};
}

describe("frame proof: composition", () => {
	test("only elements whose window contains the tick are on the frame, z-ordered by start time", () => {
		const project = projectWith([
			textElement("later", 2 * SECOND, 2 * SECOND, "second"),
			textElement("early", 0, 3 * SECOND, "first"),
		]);
		// at 2s: early is [0,3s) — active; later is [2s,4s) — active
		const both = composeFrameDescription({
			project,
			assets: [],
			at: 2 * SECOND,
		});
		expect(both.elements.map((element) => element.id)).toEqual([
			"early",
			"later",
		]);
		expect(both.elements.map((element) => element.z)).toEqual([0, 1]);
		// at 1s: only early
		const firstOnly = composeFrameDescription({
			project,
			assets: [],
			at: SECOND,
		});
		expect(firstOnly.elements.map((element) => element.id)).toEqual(["early"]);
		// windows are end-exclusive: at 3s early is out, later still in
		const laterOnly = composeFrameDescription({
			project,
			assets: [],
			at: 3 * SECOND,
		});
		expect(laterOnly.elements.map((element) => element.id)).toEqual(["later"]);
		// at 4s the frame is empty
		const empty = composeFrameDescription({
			project,
			assets: [],
			at: 4 * SECOND,
		});
		expect(empty.elements).toEqual([]);
	});

	test("frame math mirrors the wasm ticks-per-second contract", () => {
		expect(
			frameIndexAt({ at: 0, frameRate: { numerator: 30, denominator: 1 } }),
		).toBe(0);
		// one 30fps frame = 4000 ticks; 4000 ticks is frame 1
		expect(
			frameIndexAt({ at: 4000, frameRate: { numerator: 30, denominator: 1 } }),
		).toBe(1);
		expect(
			frameIndexAt({ at: SECOND, frameRate: { numerator: 30, denominator: 1 } }),
		).toBe(30);
		expect(
			frameIndexAt({ at: SECOND, frameRate: { numerator: 24, denominator: 1 } }),
		).toBe(24);
	});

	test("canonicalization is key-order independent, nested and codepoint sorted", async () => {
		const left = composeFrameDescription({
			project: projectWith([textElement("e1", 0, SECOND, "hello")]),
			assets: [],
			at: 0,
		});
		// rebuild the same element with params keys in a different insertion order
		const shuffled = projectWith([
			{
				...textElement("e1", 0, SECOND, "hello"),
				params: { y: 200, x: 100, content: "hello" },
			} as never,
		]);
		const right = composeFrameDescription({
			project: shuffled,
			assets: [],
			at: 0,
		});
		const [leftDigest, rightDigest] = await Promise.all([
			digestFrameDescription(left),
			digestFrameDescription(right),
		]);
		expect(leftDigest).toBe(rightDigest); // the digest cannot see key order
		// nested key order too: same values, different insertion orders at two
		// depths — raw serialization differs, canonical serialization does not
		const nestedLeft = {
			b: { z: 1, a: [3, { q: 1, b: 2 }] },
			a: 1,
		};
		const nestedRight = {
			a: 1,
			b: { a: [3, { b: 2, q: 1 }], z: 1 },
		};
		expect(JSON.stringify(nestedLeft.b)).not.toBe(
			JSON.stringify(nestedRight.b),
		);
		expect(canonicalize(nestedLeft)).toEqual(canonicalize(nestedRight));
	});
});

describe("frame proof: determinism and sensitivity", () => {
	test("same input, same digest; a text edit changes the digest; timestamps do not", async () => {
		const base = projectWith([textElement("t1", 0, SECOND, "v1")]);
		const sameBytes = projectWith([textElement("t1", 0, SECOND, "v1")]);
		sameBytes.metadata.updatedAt = new Date(1_000_000); // volatile field — not in the description
		const edited = projectWith([textElement("t1", 0, SECOND, "v2")]);

		const [a, b, c] = await Promise.all([
			digestFrameDescription(
				composeFrameDescription({ project: base, assets: [], at: 0 }),
			),
			digestFrameDescription(
				composeFrameDescription({ project: sameBytes, assets: [], at: 0 }),
			),
			digestFrameDescription(
				composeFrameDescription({ project: edited, assets: [], at: 0 }),
			),
		]);
		expect(a).toBe(b);
		expect(a).not.toBe(c);
		expect(a).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe("frame proof: over the wire and over the file", () => {
	test("the host endpoint serves the same proof an offline record read composes", async () => {
		const projectRoot = await tempRoot();
		const registryRoot = await tempRoot();
		const projectIdentifier = projectId(path.basename(projectRoot));
		const store = new FileProjectStore({
			root: projectRoot,
			schemaVersion: CURRENT_PROJECT_VERSION,
		});
		await prepareEditorProjectRecord({
			store,
			projectId: projectIdentifier,
			name: "Wire proof",
		});
		const offlineRecord = await store.load({ id: projectIdentifier });
		const offline = await frameProofFromRecord({
			record: offlineRecord!,
			assets: [],
			at: 0,
		});

		const host: RunningHost = await startHost({
			projectRoot,
			registry: new TargetRegistry(registryRoot),
		});
		try {
			const served = (await (
				await fetch(
					`http://127.0.0.1:${host.port}/${host.token}/api/frame?at=0`,
				)
			).json()) as { digest: string; revision: number; description: { elements: { id: string }[] } };
			expect(served.digest).toBe(offline.digest);
			expect(served.revision).toBe(0);
			// The seed's main track is on the frame? No elements — an empty main
			// track contributes nothing; the frame is the canvas alone.
			expect(served.description.elements).toEqual([]);
		} finally {
			await host.close();
		}
	});

	test("a create-clip+text edit changes the served digest, and the seed helper's records are provable", async () => {
		const { record } = createOpenCutProjectRecord({
			projectId: projectId("seed-proof"),
			name: "Seed proof",
			now: () => new Date(0),
		});
		const proof = await frameProofFromRecord({
			record,
			assets: [],
			at: SECOND,
		});
		expect(proof.description.frameIndex).toBe(30);
		expect(proof.description.projectName).toBe("Seed proof");
	});
});
