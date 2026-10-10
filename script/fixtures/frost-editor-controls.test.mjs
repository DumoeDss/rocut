import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import {
	frostEffect,
	editedFrostClip,
	assertFrostTransition,
	frostChanges,
} from "./frost-editor-state.mjs";
import { frostBuildModules } from "./frost-editor-preflight.mjs";
import { createFrostClips } from "./frost-editor-project.mjs";

function graph() {
	return {
		revision: 1,
		project: { id: "p" },
		tracks: [{ id: "t" }],
		clips: [
			{
				id: "frost-static",
				editing: {
					effects: [
						{
							id: "template-frost",
							type: "frost",
							enabled: true,
							params: { coverage: 0.8 },
							animations: { keep: true },
						},
					],
				},
			},
			{ id: "peer", editing: { effects: [] } },
		],
	};
}
test("synthetic graph controls reject partial edit, neighbor loss and stale revision", () => {
	const before = graph(),
		artifacts = { clipId: "frost-static", effectId: "template-frost" };
	const expected = editedFrostClip(
		frostEffect(before, artifacts).clip,
		artifacts.effectId,
		"coverage",
		0.625,
	);
	const after = { ...structuredClone(before), revision: 2 };
	after.clips[0] = expected;
	assert.doesNotThrow(() => assertFrostTransition(before, after, expected));
	for (const mutate of [
		(g) => {
			g.revision = 1;
		},
		(g) => {
			g.clips.pop();
		},
		(g) => {
			delete g.clips[0].editing.effects[0].animations;
		},
		(g) => {
			g.project.id = "wrong";
		},
		(g) => {
			g.tracks[0].id = "wrong";
		},
	]) {
		const broken = structuredClone(after);
		mutate(broken);
		assert.throws(() => assertFrostTransition(before, broken, expected));
	}
	assert.equal(before.clips[0].editing.effects[0].params.coverage, 0.8);
});
test("build module admission rejects absent or ambiguous Frost implementation", () => {
	const names = [
		"effect-fields.tsx",
		"frost-number-field.tsx",
		"frost-stroke-edit.ts",
		"frost-stroke-fields.tsx",
	];
	const build = {
		textModules: names.map((name) => ({ path: `C:/private/${name}` })),
	};
	assert.equal(frostBuildModules(build).length, 4);
	assert.throws(() =>
		frostBuildModules({ textModules: build.textModules.slice(1) }),
	);
	assert.throws(() =>
		frostBuildModules({
			textModules: [...build.textModules, build.textModules[0]],
		}),
	);
});
test(
	"actual Creator frostImage prepares independent stroke/effect/disabled clips",
	{
		skip:
			!process.env.FROST_CREATOR_MODULE &&
			"Set actual Creator frost.mjs path; no Host/browser",
	},
	async (t) => {
		const { frostImage } = await import(
			pathToFileURL(process.env.FROST_CREATOR_MODULE).href
		);
		const image = {
			id: "source",
			kind: "image",
			mimeType: "image/png",
			attachmentKey: "source",
			byteLength: 64,
			sha256: "a".repeat(64),
		};
		const { clips, settings } = createFrostClips({ image, frostImage });
		assert.equal(settings.frameRate.numerator, 24);
		assert.deepEqual(
			clips.map((c) => c.startTime),
			[0, 120000, 240000],
		);
		assert.equal(clips[0].editing.effects[0].params.strokeCount, 1);
		assert.equal(clips[0].editing.effects[0].params.recoveryTicks, 60000);
		assert.equal(clips[2].editing.effects[0].enabled, false);
		for (const { key, value } of frostChanges)
			assert.notEqual(clips[0].editing.effects[0].params[key], value);
		clips[0].editing.effects[0].params.stroke0Radius = 0.2;
		assert.equal(clips[1].editing.effects[0].params.stroke0Radius, 0.12);
		t.diagnostic(
			"Actual Creator helper only; synthetic descriptor, no import/Host/UI/GPU execution",
		);
	},
);
test("runner's live stages stay behind explicit --live branch", async () => {
	const source = await readFile(
		new URL("../probe-frost-editor.mjs", import.meta.url),
		"utf8",
	);
	assert(
		source.indexOf('if (mode === "--preflight")') <
			source.indexOf('await import("./browser-probe-toolchain.mjs")'),
	);
	assert(!source.includes("startHost(") && !source.includes("Bun.build("));
});
