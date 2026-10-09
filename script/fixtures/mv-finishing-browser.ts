import { verifyFinishingPixels } from "./mv-finishing-pixels";
import { verifyFinishingAnimation } from "./mv-finishing-animation";
import { exportFinishing } from "./mv-finishing-export";

async function run() {
	const pixel = await verifyFinishingPixels();
	const animation = await verifyFinishingAnimation();
	const exported = await exportFinishing();
	return {
		passed: true,
		bytes: exported.bytes,
		checks: [...pixel.checks, ...animation.checks, ...exported.checks],
		observations: {
			pixels: pixel.observations,
			animation: animation.observations,
		},
		installedElectronTested: false,
	};
}
void run().then(
	(result) => Reflect.set(globalThis, "__mvFinishing", result),
	(error) =>
		Reflect.set(globalThis, "__mvFinishing", {
			error: String(error?.stack ?? error),
		}),
);
