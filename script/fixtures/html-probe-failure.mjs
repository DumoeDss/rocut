import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	resolveHtmlProbeArtifactDirectory,
	snapshotHtmlProbeSources,
} from "../html-probe-wasm-binding.mjs";

const redact = (error) =>
	String(error).replace(/https?:\/\/[^\s"'<>]+/g, "[private URL]");

/** Failure diagnostics are separate from evidence.json and never certify a run. */
export async function saveHtmlProbeFailure({
	directory,
	error,
	page,
	resultKey,
	browser,
	hostWasmIdentity,
	root,
	sourceInputs,
	consolePhases = [],
	snapshotTimeoutMs = 2000,
}) {
	resolveHtmlProbeArtifactDirectory(directory);
	let observation, observationError, timer;
	try {
		if (page)
			observation = await Promise.race([
				page.evaluate((key) => {
					const result = globalThis[key];
					return {
						started: Boolean(globalThis.__htmlProbeStarted),
						phase: globalThis.__htmlProbePhase ?? null,
						wasmIdentity: globalThis.__htmlProbeWasmIdentity ?? null,
						result: result
							? {
									passed: result.passed,
									error: result.error,
									checks: result.checks,
								}
							: null,
					};
				}, resultKey),
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(Error("Failure snapshot timed out")),
						snapshotTimeoutMs,
					);
				}),
			]);
	} catch (failure) {
		observationError = redact(failure);
	} finally {
		clearTimeout(timer);
	}
	if (observation?.result?.error)
		observation.result.error = redact(observation.result.error);
	let sourceInputsAfter, sourceSnapshotError;
	try {
		if (sourceInputs)
			sourceInputsAfter = snapshotHtmlProbeSources(
				root,
				sourceInputs.map(({ path }) => path),
			);
	} catch (failure) {
		sourceSnapshotError = redact(failure);
	}
	const receipt = {
		version: 1,
		passed: false,
		diagnosticOnly: true,
		electronTested: false,
		failure: {
			name: error?.name ?? "Error",
			message: redact(error?.message ?? error),
		},
		browser,
		observation,
		observationError,
		hostWasmIdentity,
		consolePhases: consolePhases.slice(-30).map(redact),
		sourceInputsBefore: sourceInputs,
		sourceInputsAfter,
		sourceSnapshotError,
		sourceIdentityUnchanged: Boolean(
			sourceInputs &&
			sourceInputsAfter &&
			JSON.stringify(sourceInputs) === JSON.stringify(sourceInputsAfter),
		),
		limitations: [
			"Partial failed-run observations only; no actual-bytes or workflow acceptance claim.",
		],
	};
	await writeFile(
		join(directory, "failure.json"),
		JSON.stringify(receipt, null, 2) + "\n",
		{ flag: "wx" },
	);
	return receipt;
}
