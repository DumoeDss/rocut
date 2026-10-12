import { join } from "node:path";
import { writeJson } from "../particle-c4-export-support.mjs";

/** Keep a redacted primary failure visible even when the evidence disk is full. */
export async function throwParticleEditorFailure({
	root,
	evidence,
	failure,
	redact,
	persist = writeJson,
	report = console.error,
}) {
	report(
		JSON.stringify({
			phase: "particle-editor-failure",
			root,
			primaryFailure: {
				error: redact(evidence.primaryFailure?.error ?? failure),
				stack: redact(evidence.primaryFailure?.stack ?? failure?.stack),
			},
		}),
	);
	try {
		await persist(join(root, "evidence.json"), evidence);
	} catch (error) {
		throw new AggregateError(
			[Error(redact(failure)), Error(redact(error))],
			`Particle editor failed and evidence could not be saved at ${root}`,
		);
	}
	throw Error(`Particle editor failed; retained redacted evidence at ${root}`);
}
