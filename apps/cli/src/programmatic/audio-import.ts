import { isAbsolute, join } from "node:path";
import * as wasm from "opencut-wasm";
import type { MvAudioBinding } from "@opencut/editor-contracts";
import {
	describeResource,
	readResourceFile,
	saveResourceBytes,
} from "./resource-bytes";
import {
	resourceDigest,
	validateResources,
	type ProgrammaticResourceStore,
} from "./resources";

/** No manifest-supplied paths are opened; fixed files under caller's directory. */
export async function importMvAudio({
	input,
	...context
}: ProgrammaticResourceStore & { input: unknown }) {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw Error("Expected MV audio import spec");
	const spec = input as Record<string, unknown>;
	if (
		Object.keys(spec).some(
			(k) => !["directory", "id", "expectedAudioSha256", "review"].includes(k),
		)
	)
		throw Error("Unknown MV audio import field");
	if (
		typeof spec.directory !== "string" ||
		!isAbsolute(spec.directory) ||
		typeof spec.id !== "string"
	)
		throw Error(
			"MV audio requires an absolute analysis directory and a logical resource id",
		);
	const description = {
		id: spec.id,
		kind: "analysis" as const,
		mimeType: "application/json",
	};
	validateResources([describeResource(description, 1)]);
	if (typeof wasm.prepareMvAudioJson !== "function")
		throw Error("MV audio requires the matching rebuilt Rocut WASM");
	const loaded = [];
	for (const name of ["manifest.json", "music.json", "envelopes.json"]) {
		loaded.push(
			await readResourceFile(join(spec.directory, name), {
				id: name,
				kind: "source",
				mimeType: "application/octet-stream",
			}),
		);
	}
	const [manifest, music, envelopes] = loaded.map(
		(r) =>
			JSON.parse(
				new TextDecoder("utf-8", { fatal: true }).decode(r.body),
			) as unknown,
	);
	const [manifestFile, musicFile, envelopesFile] = loaded.map((r) => ({
		sha256: r.resource.sha256,
		byteLength: r.body.byteLength,
	}));
	const result = JSON.parse(
		wasm.prepareMvAudioJson(
			JSON.stringify({
				manifest,
				music,
				envelopes,
				manifestFile,
				musicFile,
				envelopesFile,
				expectedAudioSha256: spec.expectedAudioSha256,
				review: spec.review,
			}),
		),
	) as { error?: string; data?: unknown };
	if (result.error || !result.data)
		throw Error(result.error ?? "Invalid prepared MV audio response");
	const body = new TextEncoder().encode(JSON.stringify(result.data)).buffer;
	const saved = await saveResourceBytes(context, {
		resource: describeResource(
			description,
			body.byteLength,
			resourceDigest(body),
		),
		body,
	});
	return {
		...saved,
		binding: {
			resource: spec.id,
			inputSha256: spec.expectedAudioSha256 as string,
		} satisfies MvAudioBinding,
	};
}
