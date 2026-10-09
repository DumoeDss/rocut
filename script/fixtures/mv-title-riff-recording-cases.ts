import type { TitleRiffImage } from "./mv-title-riff-reference-contract";
import { convergeReferenceDigest } from "./mv-converge-reference-realm";

export interface RecordingSample {
	readonly name: string;
	readonly variant: "intro" | "outro";
	readonly time: number;
	readonly silhouetteCue?: number;
}
export interface RecordingGroup {
	readonly name: string;
	readonly sizes: Readonly<Record<string, readonly [number, number]>>;
	readonly samples: readonly RecordingSample[];
}

/** Additional cases only. The established reference frames and gates are intact. */
export function titleRiffRecordingCases(): RecordingGroup[] {
	const intro = (
		name: string,
		time: number,
		silhouetteCue?: number,
	): RecordingSample => ({ name, variant: "intro", time, silhouetteCue });
	return [
		{
			name: "normal",
			sizes: {},
			samples: [
				intro("zero-monuments", 3.6, 0),
				intro("one-monument", 4.3, 0),
				intro("before-silhouette", 6.483333333333333),
				intro("silhouette-disabled", 6.733333333333333, -1),
				intro("alpha-zero-entry", 6.5),
				intro("visible-two-monuments", 8.483333333333333),
				intro("disappearing", 11.5),
				intro("disappeared", 12.1),
			],
		},
		...[255, 256, 257].map(
			(height): RecordingGroup => ({
				name: `boundary-184x${height}`,
				sizes: { "character.png": [184, height] },
				samples: [
					intro("alpha-zero-entry", 6.5),
					intro("visible", 6.733333333333333),
				],
			}),
		),
		{
			name: "large-mask",
			sizes: { "character.png": [2048, 1536] },
			samples: [
				intro("alpha-zero-entry", 6.5),
				intro("visible", 6.733333333333333),
				intro("lock-without-monuments", 9.13),
				intro("disappeared", 12.1),
				intro("nonmonotonic-entry-repeat", 6.5),
			],
		},
		{
			name: "large-outro-images",
			sizes: { "sky.png": [2048, 1536], "dawn.png": [2048, 1536] },
			samples: [
				{
					name: "nested-cover-before-lock",
					variant: "outro",
					time: 22.966666666666665,
				},
				{ name: "first-panel", variant: "outro", time: 24.8 },
				{
					name: "panels-resource-reuse",
					variant: "outro",
					time: 25.133333333333333,
				},
				{ name: "final-cover-and-panels", variant: "outro", time: 28.02 },
				{ name: "late-final-cover", variant: "outro", time: 29.5 },
			],
		},
	];
}

/** Own encoded fixtures with truthful sizes/hashes; never patch oracle images. */
export async function recordingImages(
	base: readonly TitleRiffImage[],
	sizes: RecordingGroup["sizes"],
): Promise<TitleRiffImage[]> {
	const result: TitleRiffImage[] = [];
	for (const asset of base) {
		const size = sizes[asset.id];
		if (!size) {
			result.push(asset);
			continue;
		}
		const bitmap = await createImageBitmap(
			new Blob([asset.body], { type: asset.mimeType }),
		);
		const canvas = document.createElement("canvas");
		canvas.width = size[0];
		canvas.height = size[1];
		try {
			const ctx = canvas.getContext("2d")!;
			ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			const blob = await new Promise<Blob>((resolve, reject) =>
				canvas.toBlob(
					(value) =>
						value
							? resolve(value)
							: reject(Error("Recording matrix PNG failed")),
					"image/png",
				),
			);
			const body = await blob.arrayBuffer();
			result.push({
				...asset,
				width: size[0],
				height: size[1],
				mimeType: "image/png",
				byteLength: body.byteLength,
				sha256: await convergeReferenceDigest(body),
				body,
			});
		} finally {
			bitmap.close();
			canvas.width = canvas.height = 1;
		}
	}
	return result;
}
