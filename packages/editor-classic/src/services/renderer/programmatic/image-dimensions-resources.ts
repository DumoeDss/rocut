import type {
	ProgrammaticResource,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
	ResolvedSequenceImage,
} from "@opencut/editor-contracts";
import * as wasm from "opencut-wasm";
import type { ProgrammaticFrame } from "./frame";
import type { ImageDecodeAdmission } from "./image-dimensions-contract";

function sameImageDeclaration({
	a,
	b,
}: {
	a: ProgrammaticResource;
	b: ProgrammaticResource;
}) {
	const fields = [
		"id",
		"kind",
		"attachmentKey",
		"mimeType",
		"byteLength",
		"sha256",
	] as const;
	return (
		a.kind === "image" &&
		b.kind === "image" &&
		Object.keys(a).length === fields.length &&
		Object.keys(b).length === fields.length &&
		fields.every((key) => a[key] === b[key])
	);
}

/** Snapshot synchronously BEFORE any digest/iframe await. The opaque Worker has
 * no WebCrypto; only owned bytes cross its private port after host verification. */
export function snapshotImageResources<T extends ResolvedProgrammaticResource>(
	resources: readonly T[],
): T[] {
	const bodies = new Map<ArrayBuffer, ArrayBuffer>();
	return resources.map((item) => {
		const resource = structuredClone(item.resource);
		if (
			!(item.body instanceof ArrayBuffer) ||
			item.body.byteLength !== resource.byteLength
		)
			throw Error("Programmatic attachment length mismatch");
		let body = bodies.get(item.body);
		if (!body) {
			body = item.body.slice(0);
			bodies.set(item.body, body);
		}
		return { ...item, resource, body };
	});
}

function envelope({
	body,
	mimeType,
}: {
	body: ArrayBuffer;
	mimeType: string;
}): Uint8Array {
	const header = new TextEncoder().encode(JSON.stringify({ mimeType }));
	const bytes = new Uint8Array(4 + header.byteLength + body.byteLength);
	new DataView(bytes.buffer).setUint32(0, header.byteLength, true);
	bytes.set(header, 4);
	bytes.set(new Uint8Array(body), 4 + header.byteLength);
	return bytes;
}

async function verify({
	item,
	signal,
}: {
	item: ResolvedProgrammaticResource;
	signal?: AbortSignal;
}) {
	signal?.throwIfAborted();
	const digest = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", item.body)),
	]
		.map((v) => v.toString(16).padStart(2, "0"))
		.join("");
	if (digest !== item.resource.sha256)
		throw Error("Image attachment digest mismatch");
	signal?.throwIfAborted();
}

/** All raster allocations are admitted before worker decode. Selected sequence
 * bodies are verified too: direct sandbox callers cannot bypass provider checks. */
export async function prepareImageAdmissions({
	source,
	frame,
	resources,
	sequenceImages,
	operation,
	signal,
}: {
	source: ProgrammaticSource;
	frame: ProgrammaticFrame;
	resources: readonly ResolvedProgrammaticResource[];
	sequenceImages: readonly ResolvedSequenceImage[];
	operation: "render" | "measure-fonts" | "measure-resources";
	signal?: AbortSignal;
}): Promise<ImageDecodeAdmission[]> {
	signal?.throwIfAborted();
	const declared = source.resources ?? [];
	if (resources.length !== declared.length)
		throw Error("Missing programmatic resources");
	if (
		resources.some(
			(r, i) => JSON.stringify(r.resource) !== JSON.stringify(declared[i]),
		)
	)
		throw Error("Resource manifest mismatch");
	if (operation === "measure-fonts") return [];
	const requests = frame.imageDimensionRequests ?? [];
	const needed = new Map(
		requests.map((request) => [request.resource.id, request.resource]),
	);
	if (needed.size !== requests.length)
		throw Error("Duplicate image dimension requests");
	for (const request of requests) {
		if (
			request.resource.kind !== "image" ||
			!declared.some((resource) =>
				sameImageDeclaration({ a: resource, b: request.resource }),
			)
		)
			throw Error("Image dimension request does not match declaration");
	}
	const selected = operation === "render" ? (frame.sequenceImages ?? []) : [];
	if (sequenceImages.length !== selected.length)
		throw Error("Missing selected sequence images");
	const images = resources.filter(
		(r) =>
			r.resource.kind === "image" &&
			(operation === "render" || needed.has(r.resource.id)),
	);
	const admissions: ImageDecodeAdmission[] = [];
	const inspect: unknown = Reflect.get(wasm, "inspectProgrammaticImageBytes");
	if ((images.length || selected.length) && typeof inspect !== "function")
		throw Error(
			"Canvas images require the matching rebuilt Rocut WASM image inspector",
		);
	const inspectImage = async (item: ResolvedProgrammaticResource) => {
		await verify({ item, signal });
		if (typeof inspect !== "function") throw Error("Missing image inspector");
		const encoded: unknown = inspect(
			envelope({ body: item.body, mimeType: item.resource.mimeType }),
		);
		if (typeof encoded !== "string")
			throw Error("Invalid image admission response");
		const result: unknown = JSON.parse(encoded);
		if (!result || typeof result !== "object" || Array.isArray(result))
			throw Error("Invalid image admission response");
		if ("error" in result)
			throw Error(`Image admission: ${String(result.error)}`);
		const width: unknown = Reflect.get(result, "width"),
			height: unknown = Reflect.get(result, "height"),
			decodedBytes: unknown = Reflect.get(result, "decodedBytes"),
			limits: unknown = Reflect.get(result, "limits");
		if (!limits || typeof limits !== "object" || Array.isArray(limits))
			throw Error("Invalid image admission or decode limits");
		const maxDimension: unknown = Reflect.get(limits, "maxDimension"),
			maxDecodedBytes: unknown = Reflect.get(limits, "maxDecodedBytes");
		if (
			typeof width !== "number" ||
			typeof height !== "number" ||
			typeof maxDimension !== "number" ||
			typeof maxDecodedBytes !== "number" ||
			width <= 0 ||
			height <= 0 ||
			!Number.isSafeInteger(width) ||
			!Number.isSafeInteger(height) ||
			!Number.isSafeInteger(maxDimension) ||
			maxDimension <= 0 ||
			!Number.isSafeInteger(maxDecodedBytes) ||
			maxDecodedBytes <= 0 ||
			decodedBytes !== width * height * 4 ||
			width > maxDimension ||
			height > maxDimension ||
			width * height * 4 > maxDecodedBytes ||
			frame.imageDecodeLimits?.maxDimension !== maxDimension ||
			frame.imageDecodeLimits?.maxDecodedBytes !== maxDecodedBytes
		)
			throw Error("Invalid image admission or decode limits");
		return {
			resource: item.resource,
			width,
			height,
			decodedBytes: width * height * 4,
		};
	};
	for (const item of images) admissions.push(await inspectImage(item));
	for (let i = 0; i < selected.length; i++) {
		const item = sequenceImages[i],
			need = selected[i];
		if (
			item.imageKey !== need.imageKey ||
			JSON.stringify(item.resource) !== JSON.stringify(need.resource)
		)
			throw Error("Selected sequence image mismatch");
		const admitted = await inspectImage(item);
		if (admitted.width !== need.width || admitted.height !== need.height)
			throw Error(
				"Encoded image dimensions do not match the image sequence manifest",
			);
	}
	signal?.throwIfAborted();
	return admissions;
}
