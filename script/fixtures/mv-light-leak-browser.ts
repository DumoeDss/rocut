import { verifyLightLeakPixels } from "./mv-light-leak-pixels";
import { exportLightLeak } from "./mv-light-leak-export";

async function run() {
	const pixels = await verifyLightLeakPixels(),
		exported = await exportLightLeak();
	return {
		passed: true,
		bytes: exported.bytes,
		expectations: exported.expectations,
		checks: [...pixels.checks, ...exported.checks],
		observations: {
			pixels: pixels.observations,
			export: exported.observations,
		},
		installedElectronTested: false,
	};
}
void run().then(
	(value) => Reflect.set(globalThis, "__mvLightLeak", value),
	(error) =>
		Reflect.set(globalThis, "__mvLightLeak", {
			error: String(error?.stack ?? error),
		}),
);
