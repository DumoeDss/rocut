import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { isEditingEffect } from "../../packages/editor-contracts/src/editing";
import { blazeSource } from "./blaze-cases";
import {
	blazeHostAtomicBatch,
	blazeHostClips,
	blazeHostInvalidCases,
} from "./blaze-host-cases";
import {
	assertBlazeHostAuthored,
	assertBlazeHostCatalog,
} from "./blaze-host-checks";
import {
	blazeHostAnimated,
	blazeHostChannel,
	blazeHostFields,
	blazeHostId,
	blazeHostParams,
	blazeHostSentinel,
	blazeHostSettings,
	blazeHostTargetIds,
	type BlazeHostResource,
	type BlazeHostShot,
} from "./blaze-host-contract";
import {
	assertBlazeHostPrivatePath,
	assertBlazeHostSnapshot,
	blazeHostOwnedFiles,
} from "./blaze-host-paths.mjs";
import {
	blazeHostDigest,
	blazeHostImage,
	loadBlazeHostAuthor,
} from "./blaze-host-source";

const image: BlazeHostResource = {
	id: "blaze.png",
	kind: "image",
	mimeType: "image/png",
	byteLength: blazeHostImage().length,
	sha256: blazeHostDigest(blazeHostImage()),
	uri: "project://test-only-placeholder",
};
const shot = (): BlazeHostShot => ({
	source: { ...blazeHostSettings, resources: [structuredClone(image)] },
	effects: [
		{
			id: blazeHostId,
			type: "blaze",
			enabled: true,
			params: { ...blazeHostParams },
		},
	],
	animations: {},
});
const staticShot = shot(),
	animatedShot = shot();
animatedShot.animations = Object.fromEntries(
	Object.entries(blazeHostAnimated).map(([key, values]) => [
		`effects.${blazeHostId}.params.${key}`,
		{
			keys: values.map((value, index) => ({
				id: `${key}-${index}`,
				time: index * 24000,
				value,
				segmentToNext: "linear",
				tangentMode: "auto",
			})),
		},
	]),
);
const fixtureClips = () => blazeHostClips({ staticShot, animatedShot });
const fieldCatalog = () => ({
	effects: {
		blaze: blazeHostFields.map(([key, min, max, step, value, keyframable]) => ({
			key,
			min,
			max,
			step,
			default: value,
			keyframable,
			type: "number",
		})),
	},
});

test("null controls fail transport shape before field-specific Rust validation", () => {
	const cases = blazeHostInvalidCases(fixtureClips());
	for (const clipId of blazeHostTargetIds) {
		const invalid = cases.find(
			(candidate) => candidate.label === `${clipId}:invalid-refraction`,
		)!;
		expect(invalid.editing.effects[0].params.refraction).toBeNull();
		expect(isEditingEffect(invalid.editing.effects[0])).toBe(false);
		expect(invalid.issue).toBe(`Invalid clip ${clipId}`);
		const stringValue = cases.find(
			(candidate) => candidate.label === `${clipId}:invalid-speed`,
		)!;
		expect(isEditingEffect(stringValue.editing.effects[0])).toBe(true);
		expect(stringValue.issue).toBe("speed");
	}
});

test("fixture catalog fixes ten fields and seven channels independently of Host discovery", () => {
	expect(blazeHostFields).toHaveLength(10);
	expect(Object.keys(blazeHostParams).sort()).toEqual(
		blazeHostFields.map(([key]) => key).sort(),
	);
	expect(Object.keys(blazeHostAnimated).sort()).toEqual(
		blazeHostFields
			.filter((field) => field[5])
			.map(([key]) => key)
			.sort(),
	);
	expect(Object.keys(blazeHostAnimated)).toHaveLength(7);
	expect(blazeHostParams.seed).not.toBe(blazeHostSettings.seed);
	expect(() => assertBlazeHostCatalog(fieldCatalog())).not.toThrow();
	for (const field of [
		"type",
		"min",
		"max",
		"step",
		"default",
		"keyframable",
	] as const) {
		const catalog = fieldCatalog();
		Object.assign(catalog.effects.blaze[0], { [field]: "incorrect" });
		expect(() => assertBlazeHostCatalog(catalog)).toThrow();
	}
	const missing = fieldCatalog();
	missing.effects.blaze.pop();
	expect(() => assertBlazeHostCatalog(missing)).toThrow();
});

test("synthetic PNG decodes losslessly to all fixture rows including hidden RGB and feathered alpha", () => {
	const png = blazeHostImage(),
		{ width, height } = blazeHostSettings;
	expect(png).toEqual(blazeHostImage());
	expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	expect([
		png.readUInt32BE(16),
		png.readUInt32BE(20),
		png[24],
		png[25],
	]).toEqual([width, height, 8, 6]);
	const compressed: Buffer[] = [];
	for (let offset = 8; offset < png.length; ) {
		const length = png.readUInt32BE(offset);
		if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
			compressed.push(png.subarray(offset + 8, offset + 8 + length));
		offset += length + 12;
	}
	const rows = inflateSync(Buffer.concat(compressed)),
		pixels = blazeSource(blazeHostSettings);
	expect(rows.length).toBe(height * (width * 4 + 1));
	for (let row = 0; row < height; row++) {
		expect(rows[row * (width * 4 + 1)]).toBe(0);
		expect(
			rows.subarray(row * (width * 4 + 1) + 1, (row + 1) * (width * 4 + 1)),
		).toEqual(
			Buffer.from(pixels.subarray(row * width * 4, (row + 1) * width * 4)),
		);
	}
	expect(pixels.some((value, i) => i % 4 === 3 && value === 0)).toBe(true);
	expect(
		pixels.some((value, i) => i % 4 === 3 && value > 0 && value < 255),
	).toBe(true);
});

test("static animated disabled and sentinel clips retain separate settings without mutating Creator output", () => {
	const before = structuredClone({ staticShot, animatedShot }),
		clips = fixtureClips();
	expect(clips).toHaveLength(4);
	expect(clips[0].editing.animations).toEqual({});
	expect(Object.keys(clips[1].editing.animations)).toHaveLength(7);
	expect(clips[2].editing.effects[0].enabled).toBe(false);
	expect(clips[3].editing.effects).toEqual([]);
	expect(clips[3].trackId).not.toBe(clips[0].trackId);
	expect(clips[3].editing.params).toEqual({ opacity: 0.625 });
	expect({ staticShot, animatedShot }).toEqual(before);
});

test("147 rejection candidates cover all three owning states and never mutate valid originals", () => {
	const clips = fixtureClips(),
		before = structuredClone(clips),
		cases = blazeHostInvalidCases(clips);
	expect(cases).toHaveLength(147);
	expect(new Set(cases.map((item) => item.label)).size).toBe(cases.length);
	for (const clipId of blazeHostTargetIds) {
		const group = cases.filter((item) => item.clipId === clipId);
		expect(group).toHaveLength(49);
		for (const [key, , , , , animated] of blazeHostFields) {
			expect(group.some((item) => item.label.endsWith(`${key}-below`))).toBe(
				true,
			);
			expect(group.some((item) => item.label.endsWith(`${key}-above`))).toBe(
				true,
			);
			expect(
				group.some((item) =>
					item.label.endsWith(
						`${key}-${animated ? "missing-fallback" : "static-channel"}`,
					),
				),
			).toBe(true);
		}
		const fractional = group.find((item) =>
			item.label.endsWith("invalid-seed"),
		)!;
		expect(fractional.editing.effects[0].params.seed).toBe(3.5);
		expect(fractional.editing.effects[0].enabled).toBe(
			clipId !== "blaze-disabled",
		);
	}
	for (const candidate of cases)
		expect(candidate.editing).not.toEqual(
			clips.find((clip) => clip.id === candidate.clipId)!.editing,
		);
	expect(clips).toEqual(before);
});

test("atomic rejection batches always place a valid visible sentinel edit before the invalid edit", () => {
	const clips = fixtureClips(),
		sentinel = clips.find((clip) => clip.id === blazeHostSentinel)!;
	const original = structuredClone(sentinel);
	for (const invalid of blazeHostInvalidCases(clips)) {
		const batch = blazeHostAtomicBatch({ invalid, sentinel });
		expect(batch).toHaveLength(2);
		expect(batch[0].clipId).toBe(sentinel.id);
		expect(batch[0].patch.editing).toEqual({
			...sentinel.editing,
			name: `Must roll back: ${invalid.label}`,
		});
		expect(batch[1].clipId).toBe(invalid.clipId);
		expect(batch[1].patch.editing).toEqual(invalid.editing);
	}
	expect(sentinel).toEqual(original);
});

test("authored-state comparison rejects lost parameters animations disabled flags source seeds and sentinel state", () => {
	const clips = fixtureClips(),
		snapshot = { clips: structuredClone(clips), tracks: [], revision: 1 };
	expect(() => assertBlazeHostAuthored({ snapshot, clips })).not.toThrow();
	for (const [key] of blazeHostFields) {
		const changed = structuredClone(snapshot);
		changed.clips[0].editing.effects[0].params[key] = null;
		expect(() =>
			assertBlazeHostAuthored({ snapshot: changed, clips }),
		).toThrow();
	}
	for (const key of Object.keys(blazeHostAnimated)) {
		const changed = structuredClone(snapshot);
		changed.clips[1].editing.animations[
			`effects.${blazeHostId}.params.${key}`
		] = blazeHostChannel(key, null);
		expect(() =>
			assertBlazeHostAuthored({ snapshot: changed, clips }),
		).toThrow();
	}
	for (const mutate of [
		(state: typeof snapshot) => {
			state.clips[2].editing.effects[0].enabled = true;
		},
		(state: typeof snapshot) => {
			state.clips[0].editing.programmatic.seed = blazeHostParams.seed;
		},
		(state: typeof snapshot) => {
			state.clips[3].editing.name = "partial transaction leak";
		},
	]) {
		const changed = structuredClone(snapshot);
		mutate(changed);
		expect(() =>
			assertBlazeHostAuthored({ snapshot: changed, clips }),
		).toThrow();
	}
});

test("Host guard rejects shared-worktree execution before loading runtime dependencies", async () => {
	expect(blazeHostOwnedFiles).toHaveLength(8);
	expect(() =>
		assertBlazeHostPrivatePath("C:/tmps/blaze-run/project"),
	).not.toThrow();
	for (const path of [
		"",
		"relative",
		"C:/tmps",
		"C:/tmps/../Users",
		"C:/tmps-other/run",
		"E:/rocut",
	])
		expect(() => assertBlazeHostPrivatePath(path)).toThrow();
	await expect(
		assertBlazeHostSnapshot({
			snapshot: "E:/rocut",
			manifestSha256: "",
			wasmUrl: "",
			wasmSha256: "",
		}),
	).rejects.toThrow();
});

test.skipIf(!process.env.ROCUT_BLAZE_CREATOR_MODULE)(
	"actual Creator blazeImage supplies all ten controls seven channels and independent source seed",
	async () => {
		const helper = await loadBlazeHostAuthor(
			process.env.ROCUT_BLAZE_CREATOR_MODULE!,
		);
		const original = structuredClone(image),
			staticResult = helper.author(image, false),
			animatedResult = helper.author(image, true);
		expect(image).toEqual(original);
		expect(staticResult.animations).toEqual({});
		expect(animatedResult.animations).toEqual(animatedShot.animations);
		expect(animatedResult.effects[0].params).toEqual(blazeHostParams);
		expect(animatedResult.source.seed).toBe(97);
		expect(animatedResult.source.resources).toEqual([image]);
		expect(animatedResult.source.recipe).toMatchObject({
			version: 1,
			root: "shot",
		});
		expect(helper.files).toHaveLength(2);
	},
);
