import type {
	ProgrammaticResource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { ImageDecodeAdmission } from "./image-dimensions-contract";
import type { HeartNativePixels } from "./mv-heart-owner-provider";
import { key } from "./mv-heart-owner-provider-protocol";

export interface HeartNativeImageInput {
	readonly resources: readonly ResolvedProgrammaticResource[];
	readonly imageAdmissions: readonly ImageDecodeAdmission[];
	readonly imageDecodeLimits?: {
		readonly maxDimension: number;
		readonly maxDecodedBytes: number;
	};
}

/** Only the consumed canonical ticket supplies bytes/container admission. No
 * authored dimensions, pixel JSON, URL, resize or decoder fallback participates.
 * The provider owns the returned binary views; its factory drains this await.
 */
export async function readHeartNativePixels({
	input,
	resource,
	signal,
}: {
	input: HeartNativeImageInput;
	resource: ProgrammaticResource;
	signal?: AbortSignal;
}): Promise<HeartNativePixels> {
	signal?.throwIfAborted();
	const items = input.resources.filter(
		(item) => key(item.resource) === key(resource),
	);
	const admissions = input.imageAdmissions.filter(
		(item) => key(item.resource) === key(resource),
	);
	const limits = input.imageDecodeLimits;
	if (
		resource.kind !== "image" ||
		items.length !== 1 ||
		admissions.length !== 1 ||
		!limits
	)
		throw Error("Heart native decode requires one complete admitted image");
	const item = items[0]!,
		admission = admissions[0]!;
	if (
		!(item.body instanceof ArrayBuffer) ||
		item.body.byteLength !== resource.byteLength ||
		![admission.width, admission.height, admission.decodedBytes].every(
			Number.isSafeInteger,
		) ||
		admission.width < 1 ||
		admission.height < 1 ||
		admission.width > limits.maxDimension ||
		admission.height > limits.maxDimension ||
		admission.decodedBytes !== admission.width * admission.height * 4 ||
		admission.decodedBytes > limits.maxDecodedBytes
	)
		throw Error("Heart native image binary/dimension admission mismatch");
	const bitmap = await createImageBitmap(
		new Blob([item.body], { type: resource.mimeType }),
	);
	let canvas: HTMLCanvasElement | undefined;
	try {
		signal?.throwIfAborted();
		if (bitmap.width !== admission.width || bitmap.height !== admission.height)
			throw Error("Heart native actual decoded dimensions mismatch");
		canvas = document.createElement("canvas");
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext("2d", {
			willReadFrequently: true,
			colorSpace: "srgb",
		});
		if (!ctx) throw Error("Heart native Canvas2D readback unavailable");
		ctx.drawImage(bitmap, 0, 0);
		const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
		if (data.byteLength !== admission.decodedBytes)
			throw Error("Heart native readback byte length mismatch");
		signal?.throwIfAborted();
		return {
			resource: structuredClone(resource),
			encoded: item.body,
			width: bitmap.width,
			height: bitmap.height,
			rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		};
	} finally {
		bitmap.close();
		if (canvas) canvas.width = canvas.height = 1;
	}
}
