import assert from "node:assert/strict";
import { test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createFxAutomationOracle } from "./hyperframes-fx-automation-fixture";
import { fixtureAdd, fixtureGain } from "./hyperframes-graph-chain-fixture";
import { variableRateCases } from "./hyperframes-variable-rate-cases";
import { verifyRateHostConsumer } from "./hyperframes-variable-rate-host-check";
import { rateHostProject } from "./hyperframes-variable-rate-host-project";
import { digest } from "./hyperframes-variable-rate-io";
import { LOOP_TEST_FX } from "./hyperframes-variable-rate-loop-graph";
import {
	loopHostMedia,
	type LoopHostKind,
} from "./hyperframes-variable-rate-loop-host-media";
import { loadVariableRateNative } from "./hyperframes-variable-rate-native";
import { rateReferenceAtGraphRate } from "./hyperframes-variable-rate-production-media";

function absolute(name: string) {
	const value = process.env[name];
	assert.ok(value && isAbsolute(value));
	return value;
}

test("authored loop variable-rate media → real browser collection → Host → editor 44100 consumer", async () => {
	const directory = await mkdtemp(join(tmpdir(), "rocut-hf-rate-loop-host-"));
	const report: Record<string, unknown> = {
		status: "running",
		directory,
		cases: [],
	};
	console.log(JSON.stringify({ event: "started", directory }));
	const controller = new AbortController(),
		timeout = setTimeout(
			() => controller.abort(Error("Loop Host deadline")),
			175000,
		);
	try {
		const wasmDirectory = absolute("ROCUT_TEST_WASM_DIRECTORY");
		report.wasm = {
			directory: wasmDirectory,
			sha256: digest(
				await readFile(join(wasmDirectory, "opencut_wasm_bg.wasm")),
			),
		};
		const toolchain = absolute("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN");
		const decoder = {
			ffmpeg: absolute("ROCUT_TEST_FFMPEG"),
			ffprobe: absolute("ROCUT_TEST_FFPROBE"),
		};
		const native = await loadVariableRateNative({
			...decoder,
			toolchain,
			archive: absolute("ROCUT_TEST_HYPERFRAMES_ARCHIVE"),
		});
		report.nativeProvenance = native.provenance;
		const base = variableRateCases.find(
			(value) => value.id === "falling-log-mono",
		);
		assert.ok(base && typeof base.rate === "object");
		const testCase = { ...base, duration: 1.6, mediaStart: 0.1 };
		const rate = native.automation.normalizeAutomation({
			version: 1,
			lanes: [base.rate],
		}).lanes[0];
		const selection = process.env.ROCUT_TEST_LOOP_HOST_KIND;
		const kinds: LoopHostKind[] = ["wav", "mp4-audio", "mp4-silent"];
		assert.ok(!selection || kinds.includes(selection as LoopHostKind));
		const fixtures = [];
		for (const kind of kinds.filter(
			(value) => !selection || value === selection,
		)) {
			const fixture = await loopHostMedia(
				directory,
				decoder.ffmpeg,
				native,
				kind,
				testCase,
				rate,
			);
			const dry = await rateReferenceAtGraphRate(
				decoder.ffmpeg,
				fixture.reference,
				testCase.duration,
				44100,
			);
			fixtures.push({
				...fixture,
				dry,
				expected: Buffer.alloc(1.8 * 44100 * 8),
			});
		}
		const fx = await createFxAutomationOracle(toolchain, controller);
		try {
			report.fxOracleProvenance = fx.provenance;
			for (const fixture of fixtures) {
				const effected = await fx.render(
					{ sampleRate: 44100, chain: { version: 1, nodes: LOOP_TEST_FX } },
					fixture.dry,
				);
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
				{ loop: true, fxNodes: LOOP_TEST_FX },
			);
			const result = await verifyRateHostConsumer(
				project,
				toolchain,
				decoder,
				fixture.expected,
				fixture.media.hasAudio,
				controller.signal,
				{ firstFrame: 63, frameCount: 23 },
			);
			const record = {
				kind: fixture.media.kind,
				sourceDuration: fixture.sourceDuration,
				...result,
			};
			(report.cases as unknown[]).push(record);
			console.log(JSON.stringify({ event: "host-consumer-passed", ...record }));
		}
		report.status = "passed";
	} catch (error) {
		report.status = "failed";
		report.error = error instanceof Error ? error.stack : String(error);
		throw error;
	} finally {
		clearTimeout(timeout);
		await writeFile(
			join(directory, "verification.json"),
			JSON.stringify(report, null, 2) + "\n",
			{ flag: "wx" },
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
