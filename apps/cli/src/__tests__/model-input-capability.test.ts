import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import * as installedRust from "../../../../rust/wasm/pkg/opencut_wasm_sync.js";
import { modelInputCapability } from "../programmatic/model-input-capability";
import { describeResource } from "../programmatic/resource-bytes";
import {
	getProgrammaticResourceCapability,
	PROGRAMMATIC_RESOURCE_CAPABILITY,
} from "../programmatic/resource-import";

test("actual installed Rust reports model MIME admission directly without IO", () => {
	const capability = modelInputCapability(
		installedRust.validateProgrammaticResourcesJson,
	);
	const svgDescriptor = describeResource(
		{ id: "model-input-probe", kind: "model", mimeType: "image/svg+xml" },
		1,
	);
	const svgAdmission = JSON.parse(
		installedRust.validateProgrammaticResourcesJson(
			JSON.stringify([svgDescriptor]),
		),
	).length
		? "rejected"
		: "accepted";
	if (process.env.ROCUT_TEST_MODEL_INPUT_EXPECT_SVG)
		expect(svgAdmission).toBe(process.env.ROCUT_TEST_MODEL_INPUT_EXPECT_SVG);
	expect(capability.scope).toBe(
		"descriptor-only; no-file-io-or-decoder-gpu-health",
	);
	expect(capability.archiveScope).toBe(
		"separate-modelArchive-source-import; not-probed",
	);
	expect(capability.mimeTypes).toEqual([
		{ mimeType: "model/gltf-binary", admission: "accepted" },
		{ mimeType: "image/svg+xml", admission: svgAdmission },
		{ mimeType: "model/gltf+json", admission: "rejected" },
		{ mimeType: "image/ktx2", admission: "rejected" },
		{ mimeType: "image/png", admission: "rejected" },
	]);
	expect(capability).not.toHaveProperty("configured");
});

test("injected newer validation transport changes SVG admission rather than hardcoding MIME support", () => {
	const requests: unknown[] = [];
	const capability = modelInputCapability((json) => {
		const descriptors = JSON.parse(json);
		requests.push(descriptors);
		return descriptors[0].mimeType === "image/svg+xml"
			? "[]"
			: installedRust.validateProgrammaticResourcesJson(json);
	});
	expect(
		capability.mimeTypes.find((item) => item.mimeType === "image/svg+xml")
			?.admission,
	).toBe("accepted");
	expect(requests).toHaveLength(5);
	for (const request of requests) {
		expect(request).toMatchObject([
			{
				id: "model-input-probe",
				kind: "model",
				byteLength: 1,
				sha256: "0".repeat(64),
				attachmentKey: `programmatic-sha256-${"0".repeat(64)}`,
			},
		]);
	}
});

test("malformed or trapping validation transports are not falsely reported as MIME rejection or support", () => {
	for (const validate of [
		() => {
			throw Error("validator unavailable");
		},
		() => "{",
		() => "{}",
		() => "null",
		() => '[{"message":"bad"}]',
		() => "[null]",
	]) {
		expect(
			modelInputCapability(validate).mimeTypes.every(
				(item) => item.admission === "not-probed",
			),
		).toBe(true);
	}
});

test("live resource capability uses the same probe and preserves the legacy export and current archive fields", () => {
	const before = structuredClone(PROGRAMMATIC_RESOURCE_CAPABILITY);
	const validate = installedRust.validateProgrammaticResourcesJson;
	const { modelInputs, ...legacy } =
		getProgrammaticResourceCapability(validate);
	expect(legacy).toEqual(before);
	expect(modelInputs).toEqual(modelInputCapability(validate));
	expect(PROGRAMMATIC_RESOURCE_CAPABILITY).toEqual(before);
	expect(PROGRAMMATIC_RESOURCE_CAPABILITY).not.toHaveProperty("modelInputs");
	expect(getProgrammaticResourceCapability().modelInputs).toEqual(
		modelInputCapability(),
	);
	expect(
		getProgrammaticResourceCapability(() => "[]").modelInputs.mimeTypes.every(
			(item) => item.admission === "accepted",
		),
	).toBe(true);
	expect(
		getProgrammaticResourceCapability(() => "{").modelInputs.mimeTypes.every(
			(item) => item.admission === "not-probed",
		),
	).toBe(true);
});

const privateModule = process.env.ROCUT_TEST_MODEL_INPUT_WASM_MODULE;
test.skipIf(!privateModule)(
	"actual private newer Rust accepts SVG model descriptors while GLTF JSON remains a separate archive path",
	async () => {
		const newer = await import(pathToFileURL(privateModule!).href);
		const capability = modelInputCapability(
			newer.validateProgrammaticResourcesJson,
		);
		expect(
			capability.mimeTypes.find((item) => item.mimeType === "image/svg+xml")
				?.admission,
		).toBe("accepted");
		expect(
			capability.mimeTypes.find((item) => item.mimeType === "model/gltf-binary")
				?.admission,
		).toBe("accepted");
		expect(
			capability.mimeTypes.find((item) => item.mimeType === "model/gltf+json")
				?.admission,
		).toBe("rejected");
	},
);
