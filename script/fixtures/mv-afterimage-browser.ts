import type { AfterimageReference } from "./mv-afterimage-reference-contract";
import { createAfterimageReference } from "./mv-afterimage-reference-browser";
import { afterimageAssets } from "./mv-afterimage-assets";
import { afterimageSource } from "./mv-afterimage-source";
import { verifyAfterimagePixels } from "./mv-afterimage-pixels";
import { exportAfterimage } from "./mv-afterimage-export";
import { verifyAfterimageComposition } from "./mv-afterimage-composition";

async function run() {
	const assets = await afterimageAssets();
	const oracle = await createAfterimageReference({
		...assets,
		reference: Reflect.get(
			window,
			"__afterimageReference",
		) as AfterimageReference,
	});
	try {
		const source = afterimageSource(assets.resources.map((r) => r.resource));
		const pixels = await verifyAfterimagePixels(
			source,
			assets.resources,
			oracle,
		);
		const exported = await exportAfterimage(source, assets.resources, oracle);
		const composition = await verifyAfterimageComposition(
			source,
			assets.resources,
		);
		return {
			passed: true,
			...exported,
			checks: [...pixels.checks, ...exported.checks, ...composition.checks],
			observations: pixels.observations,
			composition: composition.observations,
			provenance: oracle.provenance,
			installedElectronTested: false,
		};
	} finally {
		oracle.dispose();
	}
}
void run().then(
	(value) => Reflect.set(globalThis, "__mvAfterimage", value),
	(error) =>
		Reflect.set(globalThis, "__mvAfterimage", {
			passed: false,
			error: String(error?.stack ?? error),
		}),
);
