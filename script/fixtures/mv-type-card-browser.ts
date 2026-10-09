import type { TypeCardReference } from "./mv-type-card-reference-contract";
import { createTypeCardReference } from "./mv-type-card-reference-browser";
import { typeCardAssets } from "./mv-type-card-assets";
import { verifyTypeCardPixels } from "./mv-type-card-pixels";
import { verifyTypeCardComposition } from "./mv-type-card-composition";
import { exportTypeCard } from "./mv-type-card-export";

async function run() {
	Reflect.set(globalThis, "__mvTypeCardProgress", { stage: "assets" });
	const assets = await typeCardAssets();
	Reflect.set(globalThis, "__mvTypeCardProgress", { stage: "oracle" });
	const oracle = await createTypeCardReference({
		fonts: assets.fonts,
		reference: Reflect.get(window, "__typeCardReference") as TypeCardReference,
	});
	try {
		if (Reflect.get(globalThis, "__typeCardNativeExportOnly") === true) {
			const writeOraclePng: unknown = Reflect.get(
				globalThis,
				"__writeTypeCardOraclePng",
			);
			if (typeof writeOraclePng !== "function")
				throw Error("Missing dedicated native-export PNG sink");
			Reflect.set(globalThis, "__mvTypeCardProgress", {
				stage: "native-export",
			});
			const exported = await exportTypeCard(assets.resources, oracle, {
				width: 1920,
				height: 1080,
				writeOraclePng: (frame, base64) => writeOraclePng(frame, base64),
			});
			return {
				passed: true,
				...exported,
				mode: "native-export-only",
				installedElectronTested: false,
				exportTested: true,
				pixelSuiteRun: false,
				compositionSuiteRun: false,
				scopeNote:
					"Additional native-size export evidence; does not replace or relabel the failed low-resolution codec-quality gate",
			};
		}
		const pixels = await verifyTypeCardPixels(assets.resources, oracle);
		const progress = Reflect.get(globalThis, "__mvTypeCardProgress") as Record<
			string,
			unknown
		>;
		progress.stage = "composition";
		const composition = await verifyTypeCardComposition(assets.resources);
		progress.composition = composition.observations;
		progress.stage = "export";
		const exported = await exportTypeCard(assets.resources, oracle);
		progress.stage = "complete";
		return {
			passed: true,
			...exported,
			observations: pixels.observations,
			provenance: pixels.provenance,
			composition: composition.observations,
			checks: [...pixels.checks, ...composition.checks, ...exported.checks],
			installedElectronTested: false,
			exportTested: true,
		};
	} finally {
		oracle.dispose();
	}
}
void run().then(
	(result) => Reflect.set(globalThis, "__mvTypeCard", result),
	(error) =>
		Reflect.set(globalThis, "__mvTypeCard", {
			passed: false,
			error: String(error?.stack ?? error),
			progress: Reflect.get(globalThis, "__mvTypeCardProgress"),
		}),
);
