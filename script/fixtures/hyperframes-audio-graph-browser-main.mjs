import { verifyOrder } from "./hyperframes-audio-graph-browser-order.mjs";
import { verifyCurves } from "./hyperframes-audio-graph-browser-curves.mjs";
import { verifyState } from "./hyperframes-audio-graph-browser-state.mjs";

async function run() {
	const results = [];
	for (const verify of [verifyOrder, verifyCurves, verifyState]) {
		console.log(`Native graph oracle: ${verify.name}`);
		results.push(await verify());
	}
	return {
		passed: true,
		sampleRate: 48000,
		results: results.map(({ artifacts, ...result }) => result),
		artifacts: results.flatMap((result) => result.artifacts),
		scope:
			"Pinned upstream native browser PCM oracle only; no Rocut graph parity, full video export, all-sixteen-FX coverage or installed/Electron acceptance",
	};
}
void run().then(
	(result) => Reflect.set(globalThis, "__hyperframesGraphOracle", result),
	(error) =>
		Reflect.set(globalThis, "__hyperframesGraphOracle", {
			error: String(error?.stack ?? error),
		}),
);
