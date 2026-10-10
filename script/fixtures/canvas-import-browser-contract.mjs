import { bubbleCases } from "./bubble-cases.mjs";
import { BUBBLE_NATIVE_GATES } from "./bubble-metrics.mjs";

export const canvasImportCallers = Object.freeze(["effects", "masks", "upload"]);
export const canvasImportFaults = Object.freeze([
	{ id: "zero-width", width: 0, height: 64, error: "Canvas texture import requires nonzero width and height" },
	{ id: "zero-height", width: 96, height: 0, error: "Canvas texture import requires nonzero width and height" },
	{ id: "device-width", width: 4294967295, height: 64, error: "Canvas texture import exceeds the device texture dimension limit" },
	{ id: "device-height", width: 96, height: 4294967295, error: "Canvas texture import exceeds the device texture dimension limit" },
	{ id: "source-width", width: 97, height: 64, error: "Canvas texture import rectangle exceeds the source canvas dimensions" },
	{ id: "source-height", width: 96, height: 65, error: "Canvas texture import rectangle exceeds the source canvas dimensions" },
	{ id: "unavailable-2d", width: 96, height: 64, error: "Canvas texture import requires an available 2d context", fallbackOnly: true },
	{ id: "native-read-error", width: 96, height: 64, originalJsError: true, fallbackOnly: true },
].map(Object.freeze));
export const canvasImportMatrix = Object.freeze(canvasImportCallers.flatMap((caller) =>
	canvasImportFaults.map((fault) => Object.freeze({ caller, ...fault, key: `${caller}-${fault.id}` }))));
const sample = (id) => {
	const result = bubbleCases.find((item) => item.id === id);
	if (!result) throw Error(`Missing frozen Bubble oracle sample ${id}`);
	return result;
};
export const canvasImportRecoverySample = sample("input-holes-poison");
export const canvasImportNormalSamples = Object.freeze([
	sample("input-holes-poison"), sample("input-saturated-border"),
	...[0, 1, 8, 16, 64, 128, 255].map((alpha) => sample(`alpha-${alpha}`)),
]);
export const canvasImportBrowserContract = Object.freeze({
	version: 1, callers: canvasImportCallers, rejectedCases: canvasImportMatrix.length,
	subrectangle: Object.freeze({ width: 64, height: 32, canvasWidth: 96, canvasHeight: 64 }),
	nativeGates: BUBBLE_NATIVE_GATES,
	covered: Object.freeze(["dimension preflight", "source rectangle bounds", "fallback null 2D context", "fallback original getImageData exception"]),
	notCovered: Object.freeze(["wgpu external-copy exceptions", "device loss", "allocation/OOM", "unexpected traps", "fallback thrown get_context exception", "wrong-type get_context return", "malformed ImageData byte count"]),
	scope: "Separate new native-import regression. Never changes existing Bubble fixtures/gates; independent frozen oracle expected on canonical Canvas source. No Host/export acceptance.",
});
