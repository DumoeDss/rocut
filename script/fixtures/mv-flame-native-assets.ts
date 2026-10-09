import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { kanjiDigest as digest } from "./mv-kanji-slam-reference-realm";

/** Changed encoded identity/actual dimensions, independent of scene math. */
export async function flameNativeAsset({
	base,
	variant,
}: {
	base: ResolvedProgrammaticResource;
	variant: "changed-body" | "dimensions" | "new-id";
}): Promise<ResolvedProgrammaticResource> {
	if (variant === "new-id")
		return {
			body: base.body.slice(0),
			resource: { ...base.resource, id: "flame-native-renamed" },
		};
	const bitmap = await createImageBitmap(
		new Blob([base.body], { type: "image/png" }),
	);
	const canvas = document.createElement("canvas");
	canvas.width = variant === "dimensions" ? 720 : bitmap.width;
	canvas.height = variant === "dimensions" ? 1200 : bitmap.height;
	try {
		const ctx = canvas.getContext("2d")!;
		ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		if (variant === "changed-body") {
			ctx.fillStyle = "rgba(33,129,211,.87)";
			ctx.fillRect(489, 578, 27, 83);
		}
		const blob = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(value) =>
					value ? resolve(value) : reject(Error("Flame variant PNG failed")),
				"image/png",
			),
		);
		const body = await blob.arrayBuffer(),
			sha256 = await digest(body);
		return {
			body,
			resource: {
				...base.resource,
				byteLength: body.byteLength,
				sha256,
				attachmentKey: `programmatic-sha256-${sha256}`,
			},
		};
	} finally {
		bitmap.close();
		canvas.width = canvas.height = 1;
	}
}
