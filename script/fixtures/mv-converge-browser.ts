import type { ConvergeReference } from "./mv-converge-reference-contract";
import { createConvergeReference } from "./mv-converge-reference-browser";
import { CONVERGE_BEATS } from "./mv-converge-source";
import { verifyConvergePixels } from "./mv-converge-pixels";
import { exportConverge } from "./mv-converge-export";

async function run() {
	const reference = Reflect.get(
		globalThis,
		"__convergeReference",
	) as ConvergeReference;
	const mode = Reflect.get(globalThis, "__convergeAcceptanceMode") as
		| "full"
		| "browser-only"
		| "diagnostic-only"
		| "native-export-only";
	Reflect.set(globalThis, "__mvConvergeProgress", { stage: mode });
	const pixel =
		mode === "native-export-only"
			? null
			: await verifyConvergePixels(reference, mode === "diagnostic-only");
	if (
		mode === "browser-only" ||
		mode === "diagnostic-only" ||
		(pixel && !pixel.passed)
	)
		return {
			mode,
			...pixel,
			pixelSuiteRun: mode !== "diagnostic-only",
			diagnosticMatrixRun: mode === "diagnostic-only",
			exportTested: false,
			installedElectronTested: false,
		};
	const writeOraclePng: unknown = Reflect.get(
		globalThis,
		"__writeConvergeOraclePng",
	);
	if (typeof writeOraclePng !== "function")
		throw Error(
			"Converge native export requires its restricted PNG artifact sink",
		);
	const progress = Reflect.get(globalThis, "__mvConvergeProgress") as Record<
		string,
		unknown
	>;
	progress.stage = "native-export";
	const oracle = await createConvergeReference({
		reference,
		beats: CONVERGE_BEATS,
	});
	try {
		const exported = await exportConverge(oracle, (index, base64) =>
			writeOraclePng(index, base64),
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
			scopeNote:
				"Only target native-size codec acceptance; no low-resolution quality or installed-Electron claim",
		};
	} finally {
		oracle.dispose();
	}
}
void run().then(
	(result) => Reflect.set(globalThis, "__mvConverge", result),
	(error) =>
		Reflect.set(globalThis, "__mvConverge", {
			passed: false,
			error: String(error?.stack ?? error),
			progress: Reflect.get(globalThis, "__mvConvergeProgress"),
		}),
);
