import { expect, spyOn, test } from "bun:test";
import type { ProgrammaticSource } from "../../packages/editor-contracts/src/programmatic";
import type { ProgrammaticResource } from "../../packages/editor-contracts/src/programmatic-resources";
import { compilePinnedRemotionProbe } from "./remotion-pinned-build-probe";

const spec = {
	version: 1,
	engine: "remotion",
	sourceDirectory: "C:/fixture",
	entryFile: "index.tsx",
	files: ["index.tsx"],
	compositionId: "Rocut",
	inputProps: { title: "input-not-returned" },
	seed: 7,
	width: 64,
	height: 64,
	durationFrames: 60,
	frameRate: { numerator: 30, denominator: 1 },
};
const resource: ProgrammaticResource = {
	id: "lock.json",
	kind: "document",
	mimeType: "text/html",
	sha256: "a".repeat(64),
	byteLength: 1,
	attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
};
const source: ProgrammaticSource = {
	version: 1,
	runtime: "html-document",
	code: "<div/>",
	width: 64,
	height: 64,
	durationFrames: 60,
	frameRate: spec.frameRate,
	seed: 7,
	build: {
		version: 1,
		engine: "remotion",
		engineVersion: "4.0.440",
		entryFile: "index.tsx",
		inputs: [],
		toolchainLock: resource,
	},
};
const receipt = {
	revision: "b".repeat(64),
	metadataAdapter: { id: "rocut-remotion-html", version: 2 },
	compositions: [{ id: "Rocut" }],
};
const result = {
	source,
	inspectionRevision: receipt.revision,
	metadataStability:
		"rechecked-before-compile; runtime-geometry-and-props-pinned-v1",
};

test("positive browser fixtures consume the Host v2 receipt, not direct compile", async () => {
	const requests: { url: string; body: unknown }[] = [];
	const fetcher = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (
				url: Parameters<typeof fetch>[0],
				options?: Parameters<typeof fetch>[1],
			) => {
				requests.push({
					url: String(url),
					body: JSON.parse(String(options?.body)),
				});
				return Response.json(requests.length === 1 ? receipt : result);
			},
			{ preconnect: globalThis.fetch.preconnect },
		),
	);
	try {
		expect(await compilePinnedRemotionProbe({ spec })).toEqual(source);
		expect(requests.map((r) => r.url)).toEqual([
			"/api/programmatic/build/inspect",
			"/api/programmatic/build/compile-inspected",
		]);
		expect(requests[0]?.body).toEqual({
			version: 1,
			sourceDirectory: spec.sourceDirectory,
			entryFile: spec.entryFile,
			files: spec.files,
			inputProps: spec.inputProps,
			seed: spec.seed,
			frameRates: { Rocut: spec.frameRate },
		});
		expect(requests[1]?.body).toEqual({
			revision: receipt.revision,
			compositionId: "Rocut",
			frameRate: spec.frameRate,
		});
	} finally {
		fetcher.mockRestore();
	}
});

test("positive fixture refuses legacy receipts, missing compositions and unpinned compile responses", async () => {
	for (const [inspection, compiled] of [
		[
			{
				...receipt,
				metadataAdapter: { ...receipt.metadataAdapter, version: 1 },
			},
			result,
		],
		[{ ...receipt, compositions: [{ id: "Wrong" }] }, result],
		[receipt, { ...result, inspectionRevision: "wrong" }],
		[receipt, { ...result, metadataStability: "legacy-unpinned" }],
		[receipt, { ...result, source: { ...source, runtime: "canvas-worker" } }],
	]) {
		let calls = 0;
		const fetcher = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				async () => Response.json(++calls === 1 ? inspection : compiled),
				{ preconnect: globalThis.fetch.preconnect },
			),
		);
		try {
			await expect(compilePinnedRemotionProbe({ spec })).rejects.toThrow();
		} finally {
			fetcher.mockRestore();
		}
	}
});
