import assert from "node:assert/strict";
import { test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createFxAutomationOracle } from "./hyperframes-fx-automation-fixture";
import { fixtureAdd, fixtureGain } from "./hyperframes-graph-chain-fixture";
import { variableRateCases } from "./hyperframes-variable-rate-cases";
import { verifyRateHostConsumer } from "./hyperframes-variable-rate-host-check";
import { rateHostProject } from "./hyperframes-variable-rate-host-project";
import { loadVariableRateNative } from "./hyperframes-variable-rate-native";
import { RATE_TEST_FX } from "./hyperframes-variable-rate-production-case";
import {
	rateProductionMedia,
	rateProductionReference,
	rateReferenceAtGraphRate,
	type RateMediaKind,
} from "./hyperframes-variable-rate-production-media";

function environmentPath(name: string) {
	const value = process.env[name];
	assert.ok(
		value && isAbsolute(value),
		`${name} requires an explicit absolute test path`,
	);
	return value;
}

test("compiled variable-rate media → browser collection → Host HTTP → editor default 44100 PCM consumer", async () => {
	const directory = await mkdtemp(join(tmpdir(), "rocut-hf-rate-host-"));
	const report: Record<string, unknown> = {
		status: "running",
		directory,
		cases: [],
	};
	console.log(JSON.stringify({ event: "started", directory }));
	const controller = new AbortController();
	const deadline = setTimeout(
		() => controller.abort(Error("Variable-rate Host acceptance deadline")),
		175000,
	);
	try {
		environmentPath("ROCUT_TEST_WASM_DIRECTORY");
		const toolchain = environmentPath("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN");
		const decoder = {
			ffmpeg: environmentPath("ROCUT_TEST_FFMPEG"),
			ffprobe: environmentPath("ROCUT_TEST_FFPROBE"),
		};
		const native = await loadVariableRateNative({
			...decoder,
			toolchain,
			archive: environmentPath("ROCUT_TEST_HYPERFRAMES_ENGINE_ARCHIVE"),
		});
		report.nativeProvenance = native.provenance;
		const testCase = {
			...variableRateCases.find((value) => value.id === "rising-log")!,
			mediaStart: 0.12,
		};
		assert.equal(typeof testCase.rate, "object");
		const rate = native.automation.normalizeAutomation({
			version: 1,
			lanes: [testCase.rate as Exclude<typeof testCase.rate, number>],
		}).lanes[0];
		assert.ok(rate);
		const filter = process.env.ROCUT_TEST_RATE_HOST_KIND;
		const kinds: RateMediaKind[] = ["wav", "mp4-audio", "mp4-silent"];
		assert.ok(
			!filter || kinds.includes(filter as RateMediaKind),
			"Unknown Host fixture selection",
		);
		const fixtures: {
			media: Awaited<ReturnType<typeof rateProductionMedia>>;
			dry: Buffer;
			expected?: Buffer;
		}[] = [];
		for (const kind of kinds.filter((value) => !filter || filter === value)) {
			const media = await rateProductionMedia(
				directory,
				decoder.ffmpeg,
				testCase,
				kind,
			);
			const reference = await rateProductionReference(
				native,
				directory,
				media,
				testCase,
				rate,
			);
			fixtures.push({
				media,
				dry: await rateReferenceAtGraphRate(
					decoder.ffmpeg,
					reference,
					testCase.duration,
					44100,
				),
			});
		}
		// Build independent expected PCM first and close its browser before Host
		// compilation/collection/FX. Expected values never use production graph kernels.
		const fx = await createFxAutomationOracle(toolchain, controller);
		try {
			report.fxOracleProvenance = fx.provenance;
			for (const fixture of fixtures) {
				const effected = await fx.render(
					{ sampleRate: 44100, chain: { version: 1, nodes: RATE_TEST_FX } },
					fixture.dry,
				);
				fixture.expected = Buffer.alloc(58653 * 8);
				fixtureAdd(
					fixture.expected,
					fixtureGain(effected.pcm, () => 0.75),
					4410,
				);
			}
		} finally {
			await fx.close();
		}
		for (const fixture of fixtures) {
			const project = await rateHostProject(
				directory,
				toolchain,
				fixture.media,
				testCase,
				rate,
				controller.signal,
			);
			const result = await verifyRateHostConsumer(
				project,
				toolchain,
				decoder,
				fixture.expected!,
				fixture.media.hasAudio,
				controller.signal,
			);
			(report.cases as unknown[]).push({ kind: fixture.media.kind, ...result });
			console.log(
				JSON.stringify({
					event: "host-consumer-passed",
					kind: fixture.media.kind,
					...result,
				}),
			);
		}
		report.status = "passed";
	} catch (error) {
		report.status = "failed";
		report.error =
			error instanceof Error
				? { name: error.name, message: error.message, stack: error.stack }
				: String(error);
		throw error;
	} finally {
		clearTimeout(deadline);
		await writeFile(
			join(directory, "verification.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
		console.log(
			JSON.stringify({
				event: "finished",
				status: report.status,
				report: join(directory, "verification.json"),
			}),
		);
	}
}, 180000);
