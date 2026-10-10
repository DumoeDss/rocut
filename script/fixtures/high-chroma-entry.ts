import { check } from "./droplets-pipeline-support";
import { highChromaContract } from "./high-chroma-contract";
import { runHighChromaPipeline } from "./high-chroma-pipeline";

const request = new URL(location.href).searchParams;
const caseId = request.get("case") ?? highChromaContract.droplets.id;
const mode = request.get("chroma") ?? "444";
if (mode === "warmup") {
	Reflect.set(globalThis, "__highChromaWarmup", {
		ready: true,
		execution: "import-only; no SceneExporter or initializeGpu call",
	});
} else {
	check(
		caseId === highChromaContract.droplets.id ||
			caseId === highChromaContract.larger.id,
		"Unknown high-chroma fixture case",
	);
	check(
		mode === "default" || mode === "420" || mode === "444",
		"Unknown high-chroma fixture mode",
	);
	Reflect.set(
		globalThis,
		"__highChromaPipeline",
		await runHighChromaPipeline({
			caseId,
			...(mode === "default" ? {} : { videoChroma: mode }),
		}),
	);
}
