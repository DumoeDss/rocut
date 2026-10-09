import {
	saveDropletsFrames,
	saveDropletsJson,
} from "./probe-droplets-artifacts.mjs";
import { saveDropletsPipeline } from "./probe-droplets-pipeline-artifacts.mjs";

export async function dropletsDeadline(promise, milliseconds, label) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(Error(`${label} timed out`)),
					milliseconds,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
export async function captureDroplets(page, artifacts, mode, report) {
	if (!page || page.isClosed()) return;
	const readGlobal = (name) =>
		dropletsDeadline(
			page.evaluate((key) => Reflect.get(globalThis, key) ?? null, name),
			5000,
			`${name} capture`,
		);
	try {
		const checks = await readGlobal(
			mode === "pipeline" ? "__dropletsPipeline" : "__dropletsResult",
		);
		if (checks !== null) {
			report.checks = checks;
			report.resultArtifact = await saveDropletsJson(
				artifacts,
				"browser-result.json",
				checks,
			);
		}
	} catch (error) {
		report.captureErrors.push(`result: ${String(error)}`);
	}
	try {
		const media = await readGlobal(
			mode === "pipeline" ? "__dropletsPipelineMedia" : "__dropletsFrames",
		);
		if (media !== null) {
			if (mode === "pipeline")
				report.pipelineMedia = await saveDropletsPipeline(artifacts, media);
			else report.rawFrames = await saveDropletsFrames(artifacts, media);
		}
	} catch (error) {
		report.captureErrors.push(`media: ${String(error)}`);
	}
	if (mode === "pipeline") {
		try {
			const diagnostics = await readGlobal("__dropletsPipelineDiagnostics");
			if (diagnostics !== null)
				report.diagnosticsArtifact = await saveDropletsJson(
					artifacts,
					"diagnostics.json",
					diagnostics,
				);
		} catch (error) {
			report.captureErrors.push(`diagnostics: ${String(error)}`);
		}
	}
}
