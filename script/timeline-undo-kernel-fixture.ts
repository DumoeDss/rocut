import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createAutomation } from "../packages/editor-automation/src/automation";
import { createTransactionNativeProjectSeed } from "../packages/editor-contracts/src/engine/native-adapter";
import {
	assetId,
	clipId,
	mediaTime,
	projectId,
	trackId,
} from "../packages/editor-contracts/src";
import { createInMemoryProjectStoreFixture } from "../packages/editor-ports/src/in-memory";

const required = (name: string) => {
	const value = process.env[name];
	if (!value || !/^[Ee]:[\\/]/.test(value))
		throw Error(name + " must select an E-drive private run directory");
	return resolve(value);
};
export const runRoot = required("TIMELINE_UNDO_RUN_ROOT");
const packageRoot = required("TIMELINE_UNDO_WASM_PKG");
const manifest = JSON.parse(
	await readFile(join(packageRoot, "package.json"), "utf8"),
);
const entry = manifest.exports?.["./sync"]?.default;
if (
	typeof entry !== "string" ||
	!entry.startsWith("./") ||
	entry.includes("..")
)
	throw Error("Private package has no safe synchronous entry");
const wasm = await import(pathToFileURL(join(packageRoot, entry)).href);
export const kernel = wasm.resolveTimelineUndoBytes as
	| ((bytes: Uint8Array) => string)
	| undefined;
if (typeof kernel !== "function")
	throw Error("Private WASM lacks the guarded undo kernel");

export function clipDigest(value: unknown): string {
	const canonical = (value: unknown): string => {
		if (value === null) return "n";
		if (typeof value === "boolean") return value ? "t" : "f";
		if (typeof value === "number") {
			if (
				!Number.isFinite(value) ||
				(Number.isInteger(value) && !Number.isSafeInteger(value))
			)
				throw Error("Unsafe digest number");
			const bytes = Buffer.alloc(8);
			bytes.writeDoubleBE(Object.is(value, -0) ? 0 : value);
			return "d" + bytes.toString("hex");
		}
		if (typeof value === "string")
			return "s" + Buffer.byteLength(value) + ":" + value;
		if (Array.isArray(value))
			return "a" + value.length + ":" + value.map(canonical).join("");
		if (value && typeof value === "object") {
			const entries = Object.entries(value).sort(([a], [b]) =>
				Buffer.compare(Buffer.from(a), Buffer.from(b)),
			);
			return (
				"o" +
				entries.length +
				":" +
				entries.map(([key, item]) => canonical(key) + canonical(item)).join("")
			);
		}
		throw Error("Unsupported digest value");
	};
	return createHash("sha256")
		.update("rocut-json-f64be-v1:" + canonical(value))
		.digest("hex");
}
export async function fixture(kind: "placement" | "replacement") {
	await mkdir(runRoot, { recursive: true });
	const physicalRunRoot = await realpath(runRoot);
	if (physicalRunRoot !== runRoot) throw Error("Run root must not redirect");
	const root = await mkdtemp(join(runRoot, "kernel-project-"));
	const id = projectId("kernel-project"),
		{ store } = createInMemoryProjectStoreFixture();
	await store.save(
		createTransactionNativeProjectSeed({
			projectId: id,
			project: {
				id,
				name: "Isolated undo kernel",
				frameRate: { numerator: 30, denominator: 1 },
				canvasWidth: 640,
				canvasHeight: 360,
				sceneState: {
					currentSceneId: "scene",
					scenes: [
						{
							id: "scene",
							name: "Main",
							isMain: true,
							mainTrackId: trackId("track"),
						},
					],
				},
			},
		}),
	);
	const automation = await createAutomation({ store, projectId: id });
	const media = Buffer.from("retained-old-video-bytes");
	const mediaDirectory = join(root, "attachments", "old");
	await mkdir(mediaDirectory, { recursive: true });
	await writeFile(join(mediaDirectory, "body.bin"), media);
	await writeFile(
		join(mediaDirectory, "metadata.json"),
		JSON.stringify({ id: "old", type: "video" }),
	);
	await automation.apply({
		operations: [
			{
				kind: "create-track",
				track: {
					id: trackId("track"),
					sceneId: "scene",
					name: "Video",
					kind: "video",
					hidden: false,
				},
			},
			...["old", "new"].map((id) => ({
				kind: "create-asset" as const,
				asset: {
					id: assetId(id),
					kind: "video" as const,
					name: id,
					duration: mediaTime({ ticks: 120000 }),
				},
			})),
			{
				kind: "create-clip",
				clip: {
					id: clipId("clip"),
					trackId: trackId("track"),
					assetId: assetId("new"),
					startTime: mediaTime({ ticks: 0 }),
					duration: mediaTime({ ticks: 60000 }),
					trimStart: mediaTime({ ticks: 4000 }),
					trimEnd: mediaTime({ ticks: 0 }),
					editing: {
						type: "video",
						params: { opacity: 0.5 },
						name: "Retained human editing",
					},
				},
			},
		],
	});
	const before = structuredClone((await automation.clips())[0]);
	const revision = Number(await automation.revision());
	const request = {
		schemaVersion: 1,
		intentId: "kernel-undo-" + kind,
		originalOperationId: "original-" + kind,
		executionHash: "a".repeat(64),
		idempotencyKey: "undo:kernel-undo-" + kind + ":" + "a".repeat(64),
		projectId: id,
		sceneId: "scene",
		expectedRevision: revision,
		kind,
		clips: [
			{
				clipId: "clip",
				afterDigest: clipDigest(before),
				afterAssetId: "new",
				...(kind === "replacement" ? { beforeAssetId: "old" } : {}),
			},
		],
		restoreAssets:
			kind === "replacement"
				? [
						{
							assetId: "old",
							byteLength: media.length,
							sha256: createHash("sha256").update(media).digest("hex"),
						},
					]
				: [],
	};
	return {
		root,
		automation,
		request,
		before,
		revision,
		mediaDirectory,
		async cleanup() {
			const actual = await realpath(root);
			if (
				dirname(actual) !== physicalRunRoot ||
				!basename(actual).startsWith("kernel-project-")
			)
				throw Error("Unsafe fixture cleanup");
			await rm(actual, { recursive: true, force: true });
		},
	};
}
