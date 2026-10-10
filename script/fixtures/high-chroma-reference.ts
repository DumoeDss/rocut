import { dropletsSource } from "./droplets-cases";
import {
	blackComposite,
	pipelineExpected,
	pipelineParamsAt,
} from "./droplets-pipeline-cases";
import { highChromaContract } from "./high-chroma-contract";

export function dropletsHighChromaReference() {
	const contract = highChromaContract.droplets;
	const source = dropletsSource(contract.width, contract.height, "opaque");
	return {
		...contract,
		source,
		baseline: blackComposite(source),
		expected: contract.localTicks.map(
			(ticks) => pipelineExpected(source, "attached", ticks, true).pixels,
		),
		paramsPerFrame: contract.localTicks.map((ticks) =>
			pipelineParamsAt(ticks, true),
		),
	};
}

function solidFrame(width: number, height: number, color: readonly number[]) {
	const bytes = new Uint8ClampedArray(width * height * 4);
	for (let offset = 0; offset < bytes.length; offset += 4)
		bytes.set([color[0], color[1], color[2], 255], offset);
	return bytes;
}

/** Analytic colors and time placement, independent of production capture. */
export function largerHighChromaReference() {
	const contract = highChromaContract.larger;
	return {
		...contract,
		baseline: solidFrame(contract.width, contract.height, [0, 0, 0]),
		expected: contract.colors.map((color) =>
			solidFrame(contract.width, contract.height, color),
		),
	};
}
