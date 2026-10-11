import { expect, test } from "bun:test";
import {
	parseCompileInput,
	sourceDescription,
	withBuildResources,
} from "../programmatic/engines/build-source";
import {
	parseBuildRevisionInput,
	reviseBuildArchive,
} from "../programmatic/engines/build-revision";
import { describeResource } from "../programmatic/resource-bytes";
import { resourceDigest } from "../programmatic/resources";

function fixture(engine: "three" | "remotion" | "hyperframes") {
	const entryFile = engine === "hyperframes" ? "index.html" : "main.tsx";
	const { source } = parseCompileInput({
		version: 1,
		engine,
		sourceDirectory: "C:/not-read",
		entryFile,
		files: [entryFile, "old.css", "pixel.png"],
		...(engine === "remotion" ? { compositionId: "Main" } : {}),
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 60,
		seed: 7,
	});
	const inputs = source.build!.inputs.map((resource) => {
		const body = new TextEncoder().encode(
			resource.id === entryFile ? "\ufefforiginal source" : "old",
		).buffer;
		return {
			resource: describeResource(
				sourceDescription(resource.id),
				body.byteLength,
				resourceDigest(body),
			),
			body,
		};
	});
	return {
		entryFile,
		inputs,
		source: withBuildResources(
			source,
			inputs.map((item) => item.resource),
			source.build!.toolchainLock,
		),
	};
}

for (const engine of ["three", "remotion", "hyperframes"] as const) {
	test(`${engine} revision creates, renames and deletes real archive files and preserves binary bytes`, () => {
		const { source, inputs, entryFile } = fixture(engine);
		const original = JSON.stringify(source);
		const renamed =
			engine === "hyperframes" ? "src/start.html" : "src/start.tsx";
		const revision = parseBuildRevisionInput({
			source,
			changes: [
				{ op: "rename", id: entryFile, to: renamed },
				{ op: "delete", id: "old.css" },
				{ op: "add", id: "src/new.css", code: "body{color:red}" },
			],
		});
		const result = reviseBuildArchive({ revision, inputs });
		expect(result.source.build!.entryFile).toBe(renamed);
		expect(result.source.build!.inputs.map((item) => item.id).sort()).toEqual(
			["pixel.png", renamed, "src/new.css"].sort(),
		);
		expect(
			new TextDecoder("utf-8", { ignoreBOM: true }).decode(
				result.inputs.find((item) => item.resource.id === renamed)!.body,
			),
		).toBe("\ufefforiginal source");
		expect(result.inputs.find((item) => item.resource.id === "pixel.png")).toBe(
			inputs.find((item) => item.resource.id === "pixel.png"),
		);
		expect(
			result.inputs.find((item) => item.resource.id === "src/new.css")!.resource
				.sha256,
		).toBe(resourceDigest(new TextEncoder().encode("body{color:red}").buffer));
		expect(JSON.stringify(source)).toBe(original);
	});
}

test("file creation and rename retain Rust portable paths, entry membership and binary admission", () => {
	const { source, entryFile } = fixture("three");
	for (const id of [
		"../escape.ts",
		"/absolute.ts",
		"C:/escape.ts",
		"node_modules/a.ts",
		"_rocut/a.ts",
		"CON.ts",
		"pixel.png",
		"old.css/nested.ts",
		"OLD.CSS",
	]) {
		expect(() =>
			parseBuildRevisionInput({
				source,
				changes: [{ op: "add", id, code: "x" }],
			}),
		).toThrow();
		expect(() =>
			parseBuildRevisionInput({
				source,
				changes: [{ op: "rename", id: entryFile, to: id }],
			}),
		).toThrow();
	}
	for (const changes of [
		[{ op: "delete", id: entryFile }],
		[{ op: "delete", id: "pixel.png" }],
		[{ op: "rename", id: "pixel.png", to: "pixel.ts" }],
		[
			{ op: "add", id: "nested.ts", code: "x" },
			{ op: "rename", id: entryFile, to: "nested.ts" },
		],
	])
		expect(() => parseBuildRevisionInput({ source, changes })).toThrow();
	expect(() =>
		parseBuildRevisionInput({ source, changes: [], entryFile: "missing.ts" }),
	).toThrow();
	expect(
		parseBuildRevisionInput({
			source,
			changes: [{ op: "delete", id: entryFile }],
			entryFile: "old.css",
		}).entryFile,
	).toBe("old.css");
});
