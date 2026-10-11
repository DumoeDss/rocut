import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyRuntimeCapabilities } from "../consume-private-runtime.mjs";

const context = {
	programmaticResources: {
		modelInputs: {
			mimeTypes: [{ mimeType: "image/svg+xml", admission: "accepted" }],
		},
		buildSourceArchive: {
			restore: "programmatic/resources/restore-build-source",
			input: ["source", "outputDirectory"],
			output: ["metadata/build-source.json"],
		},
	},
};
test("private runtime consumer requires actual SVG acceptance and complete source-restore discovery", () => {
	assert.equal(
		verifyRuntimeCapabilities(context).modelInputs,
		context.programmaticResources.modelInputs,
	);
	for (const admission of ["rejected", "not-probed"]) {
		const invalid = structuredClone(context);
		invalid.programmaticResources.modelInputs.mimeTypes[0].admission =
			admission;
		assert.throws(() => verifyRuntimeCapabilities(invalid));
	}
	const invalid = structuredClone(context);
	invalid.programmaticResources.buildSourceArchive.input = [
		"resource",
		"outputDirectory",
	];
	assert.throws(() => verifyRuntimeCapabilities(invalid));
});
