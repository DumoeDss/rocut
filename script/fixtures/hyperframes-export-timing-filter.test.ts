import { expect, test } from "bun:test";
import { nativeExportTiming } from "./hyperframes-export-timing-native";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const engine = process.env.ROCUT_TEST_HYPERFRAMES_ENGINE_DIRECTORY;
const native = test.skipIf(!toolchain || !engine);

native(
	"original JS half-ms boundaries, aligned starts and six-decimal tail trim",
	async () => {
		const oracle = await nativeExportTiming(toolchain!, engine!);
		const nextDown = 0.0004999999999999999;
		for (const [start, milliseconds] of [
			[0, 0],
			[0.00049, 0],
			[nextDown, 0],
			[0.0005, 1],
			[0.00051, 1],
			[1 / 44100, 0],
			[0.015, 15],
			[3.05, 3050],
			[86400, 86400000],
		]) {
			const filter = oracle.build({ start, end: start + 0.1 }, start + 0.2);
			expect(filter).toContain(`adelay=${milliseconds}|${milliseconds},apad`);
		}
		const duration = 0.1 + 0.25 / 48000;
		const filter = oracle.build(
			{ start: 0.00051, end: 0.00051 + duration, tailSeconds: 0.1 },
			0.4,
		);
		// Both atrim's nominal/tail clock and its placement are original JS output.
		// Passing the measured 4411-frame length instead would change this filter.
		expect(filter).toBe(
			"[0:a]atrim=0:0.200005,volume=1,adelay=1|1,apad,asetpts=N/SR/TB,atrim=0:0.4[a0]",
		);
		expect(oracle.build({ start: 0, end: 0.00003125 }, 0.1)).toContain(
			"atrim=0:0.000031,",
		);
		expect(oracle.build({ start: 0, end: 0.0000001 }, 0.1)).toContain(
			"atrim=0:0,",
		);
	},
);
