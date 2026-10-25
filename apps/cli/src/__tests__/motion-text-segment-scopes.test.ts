import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
} from "node:fs/promises";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectMotionTextFont } from "opencut-wasm/sync";
import { fileURLToPath } from "node:url";
import {
	motionTextScopeHash,
	motionTextSegmentScopes,
} from "../motion-text-segment-scopes";

const staticDir = fileURLToPath(
	new URL("../../../web/public/", import.meta.url),
);
const fontPath = "motion-text/fonts/noto-sans-jp-variable.ttf";
async function fixture() {
	const bytes = await readFile(
		new URL(`../../../web/public/${fontPath}`, import.meta.url),
	);
	const font = {
		id: "font",
		source: "builtin",
		builtinPath: fontPath,
		contentDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
	};
	const sequence = {
		id: "seq",
		revision: 0,
		duration: 360000,
		source: { text: "ABC" },
		compositionMode: "overlay",
		language: "en",
		defaults: { fontId: "font" },
		fonts: [font],
		cues: ["A", "B", "C"].map((text, index) => ({
			id: `cue${index}`,
			text,
			overrides: {},
		})),
		resolvedPlan: {
			sequenceRevision: 0,
			version: 1,
			cuts: ["A", "B", "C"].map((text, index) => ({
				id: `cut${index}`,
				cueId: `cue${index}`,
				text,
				startTime: index * 120000,
				duration: 120000,
				fontId: "font",
				preset: {},
				seed: 1,
			})),
		},
	};
	const record = {
		id: "p",
		data: {
			currentSceneId: "s",
			__opencutTransaction: { revision: 1 },
			motionTextSequences: [sequence],
		},
	};
	const ranges = [0, 120000, 240000].map((startTick) => ({
		startTick,
		endTick: startTick + 120000,
	}));
	const clips = [
		{
			id: "clip",
			sceneId: "s",
			startTime: 0,
			duration: 360000,
			trimStart: 0,
			editing: { type: "motion-text" },
			content: { kind: "motion-text", sequenceId: "seq" },
		},
	];
	const query = () =>
		motionTextSegmentScopes({
			staticDir,
			readRecord: async () => structuredClone(record),
			readClips: async () => clips,
			readTracks: async () => [],
			readSequences: async () => [sequence],
			input: {
				revision: 1,
				sourceDigest: motionTextScopeHash(record),
				sceneId: "s",
				ranges,
			},
		});
	return { query, record, sequence, ranges, clips, staticDir };
}

test("real Rust font coverage and canonical clocks isolate cuts and contiguous predecessor", async () => {
	const fixture = await fixtureFactory();
	const before = await fixture.query();
	expect(before.status).toBe("ready");
	fixture.sequence.resolvedPlan.cuts[0].text = "Z";
	fixture.sequence.cues[0].text = "Z";
	fixture.sequence.source.text = "ZBC";
	fixture.sequence.revision++;
	fixture.sequence.resolvedPlan.sequenceRevision++;
	const after = await fixture.query();
	expect(after.status).toBe("ready");
	if (before.status !== "ready" || after.status !== "ready")
		throw new Error("missing proof");
	expect(after.ranges![0].scopeDigest).not.toBe(before.ranges![0].scopeDigest);
	expect(after.ranges![1].scopeDigest).not.toBe(before.ranges![1].scopeDigest);
	expect(after.ranges![2].scopeDigest).toBe(before.ranges![2].scopeDigest);
	(fixture.sequence.resolvedPlan.cuts[0] as Record<string, unknown>).futureGlobal = true;
	const opaque = await fixture.query();
	expect(opaque.ranges![2].scopeDigest).not.toBe(after.ranges![2].scopeDigest);
	delete (fixture.sequence.resolvedPlan.cuts[0] as Record<string, unknown>).futureGlobal;
	fixture.clips[0].startTime = 120000;
	fixture.clips[0].duration = 240000;
	fixture.clips[0].trimStart = 120000;
	const trimmed = await fixture.query();
	expect(trimmed.ranges![2].scopeDigest).toBe(after.ranges![2].scopeDigest);
	fixture.clips[0].trimStart = 0;
	expect((await fixture.query()).ranges![2].scopeDigest).not.toBe(trimmed.ranges![2].scopeDigest);
	fixture.sequence.resolvedPlan.cuts[2].text = String.fromCodePoint(0x10ffff);
	expect((await fixture.query()).status).toBe("unavailable");
});
const fixtureFactory = fixture;

test("source identity, bounded ranges, and font bytes reject stale or unproved scopes", async () => {
	const fixture = await fixtureFactory();
	const input = {
		revision: 1,
		sourceDigest: motionTextScopeHash(fixture.record),
		sceneId: "s",
		ranges: fixture.ranges,
	};
	let reads = 0;
	const args = {
		staticDir,
		input,
		readRecord: async () => {
			const record = structuredClone(fixture.record);
			if (++reads > 1) record.data.__opencutTransaction.revision++;
			return record;
		},
		readClips: async () => fixture.clips,
		readTracks: async () => [],
		readSequences: async () => [fixture.sequence],
	};
	await expect(motionTextSegmentScopes(args)).rejects.toThrow("source changed");
	await expect(
		motionTextSegmentScopes({ ...args, input: { ...input, ranges: [] } }),
	).rejects.toThrow("bounded");
	fixture.sequence.fonts[0].contentDigest = `sha256:${"0".repeat(64)}`;
	expect((await fixture.query()).status).toBe("unavailable");
	fixture.sequence.fonts[0].source = "system";
	expect((await fixture.query()).status).toBe("unavailable");
});

test("rejects builtin bytes replaced after successful real font inspection", async () => {
	const fixture = await fixtureFactory();
	const parent = await realpath(os.tmpdir());
	const root = await mkdtemp(path.join(parent, "rocut-scope-font-"));
	const file = path.join(root, fontPath);
	try {
		await mkdir(path.dirname(file), { recursive: true });
		await copyFile(path.join(staticDir, fontPath), file);
		await expect(
			motionTextSegmentScopes({
				staticDir: root,
				readRecord: async () => fixture.record,
				readClips: async () => fixture.clips,
				readTracks: async () => [],
				readSequences: async () => [fixture.sequence],
				input: {
					revision: 1,
					sourceDigest: motionTextScopeHash(fixture.record),
					sceneId: "s",
					ranges: fixture.ranges,
				},
				inspectFont: (options) => {
					const result = inspectMotionTextFont(options);
					writeFileSync(file, new Uint8Array([0]));
					return result;
				},
			}),
		).rejects.toThrow("font changed");
	} finally {
		if (
			path.dirname(root) !== parent ||
			!path.basename(root).startsWith("rocut-scope-font-")
		)
			throw new Error("Unexpected fixture cleanup root");
		await rm(root, { recursive: true });
	}
});
