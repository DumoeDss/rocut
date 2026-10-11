import { openElectronAudioSession } from "./electron-audio-session";
import type { HyperframesFxProvenance } from "./hyperframes-fx-types";

/** Fresh trusted DSP realm, never authored source or an alternate browser. */
export async function createHyperframesElectronDspTarget({ connectionFile, signal, timeoutMs, expectedBrowser, expectedHostEpoch }: {
	connectionFile: string; signal: AbortSignal; timeoutMs: number;
	expectedBrowser?: HyperframesFxProvenance["browser"];
	expectedHostEpoch?: string;
}) {
	const session = await openElectronAudioSession({ connectionFile, profile: "dsp", width: 64, height: 64, signal });
	try {
		if (expectedHostEpoch && session.epoch !== expectedHostEpoch)
			throw Error("HyperFrames Electron Host identity changed before DSP execution");
		if (expectedBrowser && JSON.stringify(session.browser) !== JSON.stringify(expectedBrowser))
			throw Error("HyperFrames DSP browser differs from admitted runtime provenance");
		signal.throwIfAborted();
		return { evaluate: (expression: string) => session.evaluate(expression, { timeoutMs }), close: () => session.close() };
	} catch (error) { await session.close(); throw error; }
}
