import assert from "node:assert/strict";
import { before, test } from "node:test";
import {
	admitOriginalExport,
	assertIntegerUiReferences,
	assertSameSavedUi,
} from "./reverify-existing-video.mjs";

let original;
before(async () => {
	original = (
		await admitOriginalExport(
			"C:/tmps/rocut-stylized-f6XU4z/particle-editor-export-G0UwXs",
		)
	).admitted;
});

test("retained failed export has its pinned full-video and native provenance", () => {
	assert.equal(original.handoff.revision, 7);
	assert.equal(original.handoff.opacity, 0.55);
	assertSameSavedUi(original, structuredClone(original));
});

test("project, attachment, source and complete-state changes independently reject", () => {
	const variants = [
		(value) => {
			value.projectManifest.files[0].sha256 = "0".repeat(64);
		},
		(value) => {
			value.wrapper.record.data.metadata.duration++;
		},
		(value) => {
			value.stateSha256 = "0".repeat(64);
		},
		(value) => {
			value.state.clips[0].editing.params.opacity = 0.56;
		},
		(value) => {
			value.handoff.revision++;
		},
		(value) => {
			value.handoff.final.sourceSha256 = "0".repeat(64);
		},
	];
	for (const mutate of variants) {
		const changed = structuredClone(original);
		mutate(changed);
		assert.throws(() => assertSameSavedUi(original, changed));
	}
});

test("old outward-rounded screenshot geometry is not readmitted", () => {
	assert.throws(
		() => assertIntegerUiReferences(original.handoff),
		/integer CSS bounds/,
	);
});

function integerGeometryOnlyFixture() {
	// This only tests admission math; these are not captured PNGs or UI evidence.
	const handoff = structuredClone(original.handoff);
	for (const sample of handoff.previewReferences.samples) {
		sample.geometry.bounds = { x: 100, y: 100, width: 958, height: 538 };
		sample.visible.width = 958;
		sample.visible.height = 538;
	}
	return handoff;
}

test("measured integer, borderless DPR1 geometry passes pure CPU validation", () => {
	assertIntegerUiReferences(integerGeometryOnlyFixture());
});

test("DPR, fractional placement, outward size, borders and selection independently reject", () => {
	const variants = [
		(value) => {
			value.geometry.devicePixelRatio = 1.01;
		},
		(value) => {
			value.geometry.bounds.x += 0.25;
		},
		(value) => {
			value.visible.width++;
		},
		(value) => {
			value.geometry.css.borderLeftWidth = "1px";
		},
		(value) => {
			value.geometry.selection = ["particle-model"];
		},
	];
	for (const mutate of variants) {
		const changed = integerGeometryOnlyFixture();
		mutate(changed.previewReferences.samples[0]);
		assert.throws(() => assertIntegerUiReferences(changed));
	}
});
