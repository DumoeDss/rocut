import { isAbsolute } from "node:path";
import { launchFrameBrowser } from "./chromium-process";
import { createHyperframesFxTarget } from "./hyperframes-fx-target";
import { createHyperframesElectronDspTarget } from "./hyperframes-electron-dsp";
import { HYPERFRAMES_LOOP_SOURCE_BOOTSTRAP } from "./hyperframes-loop-source-bootstrap";
import type { HyperframesRateSourceLoop } from "./hyperframes-rate-loop-source";
import type { HyperframesFxProvenance } from "./hyperframes-fx-types";

export const HYPERFRAMES_LOOP_SOURCE_OWNER_REVISION = 1;

export interface HyperframesLoopSourceOwner {
	materialize(input: { body: Uint8Array; recipe: HyperframesRateSourceLoop; signal: AbortSignal }): Promise<Buffer>;
	dispose(): Promise<void>;
}

/** Lazy private browser; each materialization has a fresh secure target. Error,
 * abort or timeout poisons the owner. Late browser/native decode completion
 * cannot publish PCM after disposal. No authored HTML/JavaScript enters it. */
export function createHyperframesLoopSourceOwner({ executable, connectionFile, signal, timeoutMs = 300000, expectedBrowser, expectedHostEpoch }: {
	executable?: string; connectionFile?: string; signal: AbortSignal; timeoutMs?: number;
	expectedBrowser?: HyperframesFxProvenance["browser"];
	expectedHostEpoch?: string;
}): HyperframesLoopSourceOwner {
	if ((!connectionFile && (!executable || !isAbsolute(executable))) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
		throw Error("Invalid HyperFrames native loop owner configuration");
	const controller = new AbortController();
	const lifetime = AbortSignal.any([signal, controller.signal]);
	let browserPromise: ReturnType<typeof launchFrameBrowser> | undefined;
	let disposed = false, busy = false;
	const fatal = (error: Error) => controller.abort(error);
	const browser = () => browserPromise ??= launchFrameBrowser(executable!, lifetime).then(async value => {
		if (disposed || lifetime.aborted) { await value.close(); lifetime.throwIfAborted(); throw Error("Native loop owner disposed"); }
		const identity = await value.send("Browser.getVersion");
		const actual = { product: String(identity.product), revision: String(identity.revision),
			jsVersion: String(identity.jsVersion), protocolVersion: String(identity.protocolVersion) };
		if (expectedBrowser && JSON.stringify(actual) !== JSON.stringify(expectedBrowser)) {
			await value.close(); throw Error("Native loop source browser differs from admitted FX provenance");
		}
		if (disposed || lifetime.aborted) { await value.close(); lifetime.throwIfAborted(); throw Error("Native loop owner disposed"); }
		return value;
	});
	return {
		async materialize({ body, recipe, signal: requestSignal }) {
			if (disposed || busy) throw Error("Native loop source owner is disposed or busy");
			const callSignal = AbortSignal.any([lifetime, requestSignal]);
			callSignal.throwIfAborted();
			const owned = Buffer.from(body), clock = structuredClone(recipe.nativeBufferClock);
			if (!clock || clock.profile !== "hyperframes-0.8.139-native-buffer-loop-clock-v1" ||
				clock.sampleRate !== 48000 || !Number.isSafeInteger(clock.outputFrames) || clock.outputFrames < 1 ||
				clock.outputFrames !== recipe.sourceFrames || clock.outputFrames * 8 + 44 > recipe.maxWavBytes)
				throw Error("Missing Rust-admitted native loop source clock");
			busy = true;
			const abort = () => fatal(callSignal.reason instanceof Error ? callSignal.reason : Error("Native loop cancelled"));
			callSignal.addEventListener("abort", abort, { once: true });
			const timer = setTimeout(() => fatal(Error("Native HyperFrames loop source timed out")), timeoutMs);
			let target: Pick<Awaited<ReturnType<typeof createHyperframesFxTarget>>, "evaluate" | "close"> | undefined;
			try {
				target = connectionFile
					? await createHyperframesElectronDspTarget({ connectionFile, signal: lifetime, timeoutMs, expectedBrowser, expectedHostEpoch })
					: await createHyperframesFxTarget(await browser(), lifetime, fatal);
				callSignal.throwIfAborted();
				await target.evaluate(HYPERFRAMES_LOOP_SOURCE_BOOTSTRAP);
				await target.evaluate(`window.rocutNativeLoopSourceIO.configure(${JSON.stringify(clock)},${owned.length})`);
				for (let offset = 0; offset < owned.length; offset += 65536) {
					callSignal.throwIfAborted();
					await target.evaluate(`window.rocutNativeLoopSourceIO.put(${offset},${JSON.stringify(owned.subarray(offset, offset + 65536).toString("base64"))})`);
				}
				const metadata = await target.evaluate("window.rocutNativeLoopSourceIO.render()") as { frames?: number; bytes?: number };
				callSignal.throwIfAborted();
				if (metadata?.frames !== clock.outputFrames || metadata.bytes !== clock.outputFrames * 8)
					throw Error("Native loop source returned foreign PCM geometry");
				const pcm = Buffer.alloc(metadata.bytes);
				for (let offset = 0; offset < pcm.length; offset += 65536) {
					callSignal.throwIfAborted();
					const count = Math.min(65536, pcm.length - offset);
					const encoded = await target.evaluate(`window.rocutNativeLoopSourceIO.read(${offset},${count})`);
					if (typeof encoded !== "string" || encoded.length !== Math.ceil(count / 3) * 4)
						throw Error("Invalid native loop PCM transport");
					const bytes = Buffer.from(encoded, "base64");
					if (bytes.length !== count || bytes.toString("base64") !== encoded)
						throw Error("Truncated native loop PCM transport");
					for (let byte = 0; byte < bytes.length; byte += 4)
						if (!Number.isFinite(bytes.readFloatLE(byte))) throw Error("Nonfinite native loop PCM");
					bytes.copy(pcm, offset);
				}
				await target.evaluate("window.rocutNativeLoopSourceIO.dispose()");
				callSignal.throwIfAborted();
				return pcm;
			} catch (error) {
				fatal(error instanceof Error ? error : Error(String(error)));
				throw error;
			} finally {
				clearTimeout(timer); callSignal.removeEventListener("abort", abort);
				try { await target?.close(); }
				catch (error) { fatal(error instanceof Error ? error : Error(String(error))); throw error; }
				finally { busy = false; }
			}
		},
		async dispose() {
			if (disposed) return;
			disposed = true; fatal(Error("Native HyperFrames loop source owner disposed"));
			await browserPromise?.then(value => value.close(), () => {});
		},
	};
}
