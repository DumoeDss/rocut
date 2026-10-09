import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	busPcmOracleCases,
	createBusPcmOracle,
} from "../../../../script/fixtures/hyperframes-bus-pcm-oracle-fixture";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
// Independently retained Chrome 151 PCM samples, not Rust/JS event evaluation.
// AudioParam arithmetic may differ by a few ULP from scalar f64 interpolation.
const anchors: Record<string, [number, number][]> = {
	"48000-linear-zero": [
		[1, 0.10033328086137772],
		[127, 0.14232614636421204],
		[128, 0.14265942573547363],
		[129, 0.14299269020557404],
	],
	"44100-linear-zero": [
		[1, 0.10036274790763855],
		[127, 0.1460692584514618],
		[128, 0.14643201231956482],
		[129, 0.14679476618766785],
	],
	"48000-curve-negative-via": [[128, -0.021233724430203438]],
	"44100-curve-negative-via": [[128, -0.023111535236239433]],
	"48000-nonzero-clock-linear": [
		[960, 0.3700000047683716],
		[961, 0.5001253485679626],
	],
	"44100-nonzero-clock-linear": [
		[882, 0.3700000047683716],
		[883, 0.5001547932624817],
	],
	"48000-nonzero-clock-curve": [
		[960, 0.3700000047683716],
		[961, 0.9001141786575317],
	],
	"44100-nonzero-clock-curve": [
		[882, 0.3700000047683716],
		[883, 0.9001410007476807],
	],
};
test.skipIf(!toolchain)(
	"native bus AudioParam produces independent stereo PCM at 48k and 44.1k",
	async () => {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(Error("Bus PCM oracle deadline")),
			55000,
		);
		const directory = await mkdtemp(join(tmpdir(), "rocut-bus-pcm-oracle-"));
		const evidence: Record<string, unknown> = { directory, cases: [] };
		let oracle: Awaited<ReturnType<typeof createBusPcmOracle>> | undefined;
		try {
			oracle = await createBusPcmOracle(toolchain!, controller);
			evidence.provenance = oracle.provenance;
			for (const sampleRate of [48000, 44100]) {
				for (const request of busPcmOracleCases(sampleRate)) {
					const { pcm, ...metadata } = await oracle.run(request);
					const stem = `${sampleRate}-${request.name}`;
					const indices = new Set([
						0,
						1,
						126,
						127,
						128,
						129,
						255,
						256,
						257,
						Math.floor(sampleRate * 0.04),
						Math.floor(sampleRate * 0.12),
						request.frames - 1,
					]);
					for (const event of metadata.events) {
						for (const time of [
							event.time,
							event.time + (event.duration ?? 0),
						]) {
							const frame = Math.floor(time * sampleRate);
							for (let delta = -2; delta <= 2; delta++)
								if (frame + delta >= 0 && frame + delta < request.frames)
									indices.add(frame + delta);
						}
					}
					let minimum = Infinity,
						maximum = -Infinity,
						finite = true,
						multiplicationMaxError = 0;
					for (let frame = 0; frame < request.frames; frame++) {
						const left = pcm.readFloatLE(frame * 8),
							right = pcm.readFloatLE(frame * 8 + 4);
						finite &&= Number.isFinite(left) && Number.isFinite(right);
						minimum = Math.min(minimum, left);
						maximum = Math.max(maximum, left);
						multiplicationMaxError = Math.max(
							multiplicationMaxError,
							Math.abs(right - Math.fround(left * Math.fround(-0.37))),
						);
					}
					expect(finite).toBe(true);
					expect(multiplicationMaxError).toBe(0);
					if (request.name.startsWith("raw-")) {
						const expected = [0.37, 0, 1, 10 ** (12 / 20), 0, 2.5][
							Number(request.name.slice(4))
						]!;
						expect(minimum).toBe(Math.fround(expected));
						expect(maximum).toBe(minimum);
					}
					if (request.name === "constant")
						expect(minimum).toBe(Math.fround(2.3));
					if (request.name === "curve-negative-via")
						expect(minimum).toBeLessThan(-0.1);
					if (request.name === "curve-overshoot")
						expect(maximum).toBeGreaterThan(10 ** (12 / 20));
					if (request.name === "linear-late-first-point")
						expect(
							pcm.readFloatLE(Math.floor(sampleRate * 0.01) * 8),
						).toBeGreaterThan(0.3);
					if (request.name === "curve-zero")
						expect(metadata.events.map((event) => event.kind)).toEqual([
							"cancel",
							"curve",
						]);
					if (request.name === "curve-late-seed")
						expect(metadata.events.map((event) => event.kind)).toEqual([
							"cancel",
							"set",
							"curve",
						]);
					expect(
						metadata.events.some((event) => event.kind === "curve-rejected"),
					).toBe(false);
					const last = metadata.events.at(-1);
					const tailGain =
						last?.kind === "curve"
							? last.values!.at(-1)!
							: (last?.value ?? metadata.staticGain);
					expect(pcm.readFloatLE((request.frames - 1) * 8)).toBe(
						Math.fround(tailGain),
					);
					for (const [frame, expected] of anchors[stem] ?? [])
						expect(
							Math.abs(pcm.readFloatLE(frame * 8) - expected),
						).toBeLessThan(2e-6);
					const samples = [...indices]
						.sort((a, b) => a - b)
						.map((frame) => ({
							frame,
							left: pcm.readFloatLE(frame * 8),
							right: pcm.readFloatLE(frame * 8 + 4),
							leftBits: pcm.readUInt32LE(frame * 8),
							rightBits: pcm.readUInt32LE(frame * 8 + 4),
						}));
					(evidence.cases as unknown[]).push({
						request,
						...metadata,
						minimum,
						maximum,
						multiplicationMaxError,
						samples,
						file: `${stem}.f32le`,
					});
					await writeFile(join(directory, `${stem}.f32le`), pcm, {
						flag: "wx",
					});
				}
			}
			evidence.status = "passed-native-AudioParam-PCM-only";
		} catch (error) {
			evidence.error = String(error);
			throw error;
		} finally {
			clearTimeout(timeout);
			await oracle?.close();
			await writeFile(
				join(directory, "verification.json"),
				JSON.stringify(evidence, null, 2),
				{ flag: "wx" },
			);
			console.log(`Bus AudioParam PCM oracle evidence: ${directory}`);
		}
	},
	60000,
);
