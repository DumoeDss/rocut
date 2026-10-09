import type { EmberReference } from "./mv-ember-reference-contract";
import { createEmberReference } from "./mv-ember-reference-browser";
import { emberAssets } from "./mv-ember-assets";
import { emberAnalysis, emberAudioFacts } from "./mv-ember-audio";
import { verifyEmberPixels } from "./mv-ember-pixels";
import { exportEmber } from "./mv-ember-export";
import { verifyEmberComposition } from "./mv-ember-composition";
import { verifyEmberResourceFrame } from "./mv-ember-resource-frame";

async function run() {
	const reference = Reflect.get(
		globalThis,
		"__emberReference",
	) as EmberReference;
	const mode = Reflect.get(globalThis, "__emberAcceptanceMode") as
		| "full"
		| "browser-only"
		| "diagnostic-only"
		| "composition-only"
		| "native-export-only";
	Reflect.set(globalThis, "__mvEmberProgress", {
		stage: "assets",
		current: mode,
	});
	const assets = await emberAssets();
	const pixel =
		mode === "native-export-only" || mode === "composition-only"
			? null
			: await verifyEmberPixels(reference, assets, mode === "diagnostic-only");
	if (mode === "diagnostic-only" || (pixel && !pixel.passed))
		return {
			mode,
			...pixel,
			pixelSuiteRun: mode !== "diagnostic-only",
			exportTested: false,
			installedElectronTested: false,
		};
	const progress = Reflect.get(globalThis, "__mvEmberProgress") as Record<
		string,
		unknown
	>;
	progress.stage = "native-export";
	const audio = emberAudioFacts(),
		analysis = await emberAnalysis(audio);
	const resources = [
		assets.font.resolved,
		...assets.images.map((image) => image.resolved),
		analysis,
	];
	const oracle = await createEmberReference({
		reference,
		audio,
		font: assets.font.asset,
		images: assets.images.map((image) => image.asset),
	});
	try {
		if (mode !== "native-export-only") {
			progress.stage = "resource-and-composition";
			const composition = await verifyEmberComposition(resources, oracle);
			const resourceFrame = await verifyEmberResourceFrame(resources);
			if (pixel)
				Object.assign(pixel.observations, { composition, resourceFrame });
			if (mode === "browser-only" || mode === "composition-only")
				return {
					mode,
					...pixel,
					observations: { ...pixel?.observations, composition, resourceFrame },
					checks: [
						...(pixel?.checks ?? []),
						"Real joint font/image/audio/sequence facts and ref/root clocks; seed and role/composite post checks",
					],
					passed: true,
					pixelSuiteRun: mode === "browser-only",
					resourceCompositionTested: true,
					exportTested: false,
					installedElectronTested: false,
				};
		}
		progress.stage = "native-export";
		const write: unknown = Reflect.get(globalThis, "__writeEmberOraclePng");
		if (typeof write !== "function")
			throw Error("Missing restricted Ember PNG artifact sink");
		const exported = await exportEmber(
			oracle,
			audio,
			resources,
			(frame, base64) => write(frame, base64),
		);
		progress.stage = "complete";
		return {
			mode,
			...pixel,
			...exported,
			passed: true,
			checks: [...(pixel?.checks ?? []), ...exported.checks],
			pixelSuiteRun: mode !== "native-export-only",
			exportTested: true,
			installedElectronTested: false,
			lowResolutionExportTested: false,
		};
	} finally {
		oracle.dispose();
	}
}
void run().then(
	(result) => Reflect.set(globalThis, "__mvEmber", result),
	(error) =>
		Reflect.set(globalThis, "__mvEmber", {
			passed: false,
			error: String(error?.stack ?? error),
			progress: Reflect.get(globalThis, "__mvEmberProgress"),
		}),
);
