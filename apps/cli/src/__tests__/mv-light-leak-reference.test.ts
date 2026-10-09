import { expect, test } from "bun:test";
import { lightLeakReference } from "../../../../script/fixtures/mv-light-leak-reference";

test.skipIf(!process.env.ROCUT_TEST_MV_REFERENCE)(
	"original seq-overlay oracle extracts without a browser or WASM",
	async () => {
		const reference = await lightLeakReference(
			process.env.ROCUT_TEST_MV_REFERENCE!,
		);
		const gradients = reference.geometry(16.3541, 0.8, 3, 160, 96);
		expect(gradients).toHaveLength(2);
		expect(gradients[0]!.stops.map((stop) => stop.offset)).toEqual([
			0, 0.35, 1,
		]);
		expect(gradients[1]!.stops[0]!.color.slice(0, 3)).toEqual([255, 79, 106]);
		expect(gradients).not.toEqual(reference.geometry(17, 0.8, 3, 160, 96));
		console.log(
			JSON.stringify({ oracle: reference.provenance, sample: gradients }),
		);
	},
);
