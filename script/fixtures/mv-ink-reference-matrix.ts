import { createInkImage } from "./mv-ink-assets";
import { inkCases, type InkCase } from "./mv-ink-cases";
import type { InkReference } from "./mv-ink-contract";
import { createInkOracle } from "./mv-ink-oracle";
import { inkSample } from "./mv-ink-source";

type InkOriginalCapture = ReturnType<
	Awaited<ReturnType<typeof createInkOracle>>["render"]
>;

/** Browser entry seam only, not an automatically executed probe or acceptance.
 * Callback must persist/compare each full frame before the next capture; this
 * avoids retaining the entire 408-frame RGBA matrix in memory or JSON arrays.
 */
export async function captureInkOriginalMatrix({
	reference,
	onFrame,
}: {
	reference: InkReference;
	onFrame(input: {
		item: InkCase;
		visit: number;
		index: number;
		capture: InkOriginalCapture;
	}): Promise<void>;
}) {
	let observations = 0;
	for (const item of inkCases()) {
		const image = await createInkImage({ variant: item.assetVariant });
		const oracle = await createInkOracle({
			reference,
			song: item.song,
			images: [image],
		});
		try {
			for (const [visit, index] of item.indices.entries()) {
				const capture = oracle.render(inkSample({ frame: item.frame, index }));
				try {
					await onFrame({ item, visit, index, capture });
					observations++;
				} finally {
					capture.canvas.width = capture.canvas.height = 1;
				}
			}
		} finally {
			oracle.dispose();
		}
	}
	return {
		observations,
		scope:
			"Original-only full-frame captures; no native producer or parity/export acceptance",
	};
}
