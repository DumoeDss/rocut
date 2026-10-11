import { launchFrameBrowser } from "./chromium-process";
import { openElectronAudioSession } from "./electron-audio-session";
import { createHyperframesElectronDspTarget } from "./hyperframes-electron-dsp";
import { isAbsolute } from "node:path";
import { HYPERFRAMES_FX_BOOTSTRAP } from "./hyperframes-fx-bootstrap";
import { HYPERFRAMES_LOOP_SOURCE_BOOTSTRAP } from "./hyperframes-loop-source-bootstrap";
import { HYPERFRAMES_LOOP_SOURCE_OWNER_REVISION } from "./hyperframes-loop-source-owner";
import {
	createHyperframesFxTarget,
	HYPERFRAMES_FX_TARGET_POLICY,
} from "./hyperframes-fx-target";
import {
	assertHyperframesFxRuntime,
	hyperframesFxDigest,
	type HyperframesFxRuntime,
} from "./hyperframes-fx-runtime";
import type {
	HyperframesFxExecutor,
	HyperframesFxProvenance,
	HyperframesFxStage,
} from "./hyperframes-fx-types";

export const HYPERFRAMES_FX_CHUNK_BYTES = 65536;
export const HYPERFRAMES_FX_ADAPTER = Object.freeze({
	version: 1 as const,
	sha256: hyperframesFxDigest(
		`rocut-native-fx-cdp-v1\n${HYPERFRAMES_FX_CHUNK_BYTES}\n${JSON.stringify(HYPERFRAMES_FX_TARGET_POLICY)}\n${HYPERFRAMES_FX_BOOTSTRAP}\nnative-loop-owner-${HYPERFRAMES_LOOP_SOURCE_OWNER_REVISION}\n${HYPERFRAMES_LOOP_SOURCE_BOOTSTRAP}`,
	),
});

/** Shape checks at the IO boundary, not admission or DSP/clock policy. */
function checkedGeometry(stage: HyperframesFxStage, input: Uint8Array) {
	const { sampleRate, inputFrames, expectedOutputFrames, maxOutputBytes } =
		stage;
	const inputBytes = inputFrames * 8,
		outputBytes = expectedOutputFrames * 8;
	if (
		![
			inputFrames,
			expectedOutputFrames,
			maxOutputBytes,
			inputBytes,
			outputBytes,
		].every((value) => Number.isSafeInteger(value) && value >= 0) ||
		!Number.isFinite(sampleRate) ||
		sampleRate <= 0 ||
		input.byteLength !== inputBytes ||
		outputBytes > maxOutputBytes
	)
		throw Error("Native FX PCM does not match Rust-admitted IO geometry");
	return {
		plan: { sampleRate, inputFrames, expectedOutputFrames, maxOutputBytes },
		outputBytes,
	};
}

/** A serial private process, fresh target and fresh DSP history per stage.
 * Cancellation/timeouts poison and kill this executor; no partially rendered
 * result can be reused. Only complete local/global history is accepted by the
 * calling Rust plan; this interface offers no offset, seek or crop argument. */
export async function withHyperframesFxExecutor<T>(
	{
		executable,
		connectionFile,
		runtime,
		signal,
		stageTimeoutMs = 30000,
		expectedProvenance,
	}: {
		executable?: string;
		connectionFile?: string;
		runtime: HyperframesFxRuntime;
		signal: AbortSignal;
		stageTimeoutMs?: number;
		expectedProvenance?: HyperframesFxProvenance;
	},
	consume: (executor: HyperframesFxExecutor) => Promise<T>,
): Promise<T> {
	signal.throwIfAborted();
	assertHyperframesFxRuntime(runtime);
	if (!connectionFile && (!executable || !isAbsolute(executable)))
		throw Error("Native FX browser path must be host-configured and absolute");
	if (!Number.isSafeInteger(stageTimeoutMs) || stageTimeoutMs <= 0)
		throw Error("Invalid native FX stage timeout");
	const controller = new AbortController();
	const lifetime = AbortSignal.any([signal, controller.signal]);
	const fatal = (error: Error) => controller.abort(error);
	const startup = setTimeout(
		() => fatal(Error("Native FX browser startup timed out")),
		15000,
	);
	const probe = connectionFile ? await openElectronAudioSession({ connectionFile, profile: "dsp", width: 64, height: 64, signal: lifetime }).catch(error => { clearTimeout(startup); throw error; }) : undefined;
	const browser = connectionFile ? undefined : await launchFrameBrowser(executable!, lifetime).catch(
		(error) => {
			clearTimeout(startup);
			throw error;
		},
	);
	let busy = false,
		disposed = false;
	try {
		const identity = probe ? probe.browser : await browser!.send("Browser.getVersion");
		await probe?.close();
		clearTimeout(startup);
		const provenance: HyperframesFxProvenance = Object.freeze({
			...(probe ? { electronHostEpoch: probe.epoch } : {}),
			nativeVersion: runtime.nativeVersion,
			runtimeSha256: runtime.sha256,
			moduleSha256: runtime.moduleSha256,
			packageLockSha256: runtime.packageLockSha256,
			packageIntegrity: runtime.packageIntegrity,
			adapterVersion: HYPERFRAMES_FX_ADAPTER.version,
			adapterSha256: HYPERFRAMES_FX_ADAPTER.sha256,
			browser: Object.freeze({
				product: String(identity.product),
				revision: String(identity.revision),
				jsVersion: String(identity.jsVersion),
				protocolVersion: String(identity.protocolVersion),
			}),
		});
		if (
			expectedProvenance &&
			JSON.stringify(provenance) !== JSON.stringify(expectedProvenance)
		)
			throw Error(
				"HyperFrames audio runtime identity changed before DSP execution",
			);
		return await consume({
			provenance,
			async run(stage, dryStereoF32LE) {
				if (disposed) throw Error("Native HyperFrames FX executor is disposed");
				lifetime.throwIfAborted();
				if (busy) throw Error("Native HyperFrames FX stages must run serially");
				const { plan, outputBytes } = checkedGeometry(stage, dryStereoF32LE);
				const chainJson = JSON.stringify(stage.normalizedFxChain);
				const automationJson =
					stage.nativeFxAutomation == null
						? undefined
						: JSON.stringify(stage.nativeFxAutomation);
				if (chainJson === undefined)
					throw Error("Missing Rust-normalized native FX chain");
				// Snapshot the host's bytes before any await: later caller mutations must
				// not change the PCM that a checksum/cache entry describes. Rust's working
				// set must include this additional host input copy.
				const input = Buffer.from(dryStereoF32LE);
				const inputSha256 = hyperframesFxDigest(input);
				busy = true;
				const timer = setTimeout(
					() => fatal(Error("Native HyperFrames FX stage timed out")),
					stageTimeoutMs,
				);
				let target:
					| Pick<Awaited<ReturnType<typeof createHyperframesFxTarget>>, "evaluate" | "close">
					| undefined;
				try {
					target = connectionFile
						? await createHyperframesElectronDspTarget({ connectionFile, signal: lifetime, timeoutMs: stageTimeoutMs, expectedBrowser: provenance.browser, expectedHostEpoch: provenance.electronHostEpoch })
						: await createHyperframesFxTarget(browser!, lifetime, fatal);
					await target.evaluate(HYPERFRAMES_FX_BOOTSTRAP);
					await target.evaluate(runtime.code);
					await target.evaluate(
						`window.rocutNativeFxIO.configure(${JSON.stringify(plan)})`,
					);
					for (
						let offset = 0;
						offset < input.length;
						offset += HYPERFRAMES_FX_CHUNK_BYTES
					) {
						lifetime.throwIfAborted();
						const chunk = input
							.subarray(offset, offset + HYPERFRAMES_FX_CHUNK_BYTES)
							.toString("base64");
						await target.evaluate(
							`window.rocutNativeFxIO.put(${offset},${JSON.stringify(chunk)})`,
						);
					}
					const metadata = (await target.evaluate(
						`window.rocutNativeFxIO.render(${JSON.stringify(chainJson)},${JSON.stringify(automationJson) ?? "undefined"})`,
					)) as
						| { frames?: unknown; bytes?: unknown; channels?: unknown }
						| undefined;
					if (
						metadata?.frames !== plan.expectedOutputFrames ||
						metadata.bytes !== outputBytes ||
						metadata.channels !== 2
					)
						throw Error("Native FX returned inconsistent output metadata");
					const pcm = Buffer.alloc(outputBytes);
					for (
						let offset = 0;
						offset < outputBytes;
						offset += HYPERFRAMES_FX_CHUNK_BYTES
					) {
						lifetime.throwIfAborted();
						const count = Math.min(
							HYPERFRAMES_FX_CHUNK_BYTES,
							outputBytes - offset,
						);
						const encoded = await target.evaluate(
							`window.rocutNativeFxIO.read(${offset},${count})`,
						);
						if (
							typeof encoded !== "string" ||
							encoded.length !== Math.ceil(count / 3) * 4 ||
							!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
						)
							throw Error("Invalid native FX PCM transfer");
						const bytes = Buffer.from(encoded, "base64");
						if (bytes.length !== count || bytes.toString("base64") !== encoded)
							throw Error("Truncated native FX PCM transfer");
						for (let byte = 0; byte < bytes.length; byte += 4)
							if (!Number.isFinite(bytes.readFloatLE(byte)))
								throw Error("Nonfinite native FX output PCM");
						bytes.copy(pcm, offset);
					}
					await target.evaluate("window.rocutNativeFxIO.dispose()");
					lifetime.throwIfAborted();
					return {
						pcm,
						provenance,
						inputSha256,
						outputSha256: hyperframesFxDigest(pcm),
					};
				} catch (error) {
					fatal(error instanceof Error ? error : Error(String(error))); throw error;
				} finally {
					try {
						await target?.close();
					} catch (error) {
						fatal(error instanceof Error ? error : Error(String(error))); throw error;
					} finally {
						clearTimeout(timer);
						busy = false;
					}
				}
			},
		});
	} finally {
		disposed = true;
		clearTimeout(startup);
		await probe?.close();
		await browser?.close();
	}
}
