import { expect, mock, test } from "bun:test";
import type { HyperframesRateSourceLoop } from "../programmatic/hyperframes-rate-loop-source";

const browser = { product: "Chrome/test", revision: "reviewed", jsVersion: "v8/test", protocolVersion: "1.3" };
const epoch = "a".repeat(32);
const sessions: { profile: string; calls: string[]; closed: boolean }[] = [];
let changedEpoch = false, nonfinite = false;
mock.module("../programmatic/electron-audio-session", () => ({
	async openElectronAudioSession(input: { profile: string; width: number; height: number; signal: AbortSignal }) {
		expect(input.profile).toBe("dsp"); expect([input.width, input.height]).toEqual([64, 64]);
		const state = { profile: input.profile, calls: [] as string[], closed: false }; sessions.push(state);
		const output = Buffer.alloc(24); for (let i = 0; i < 6; i++) output.writeFloatLE(nonfinite ? NaN : (i + 1) / 8, i * 4);
		return { browser, epoch: changedEpoch ? "b".repeat(32) : epoch,
			async evaluate(expression: string) {
				input.signal.throwIfAborted(); state.calls.push(expression);
				if (expression.endsWith(".render()")) return { frames: 3, bytes: 24 };
				if (expression.includes(".read(")) return output.toString("base64");
				return true;
			}, async close() { state.closed = true; } };
	}
}));
const { createHyperframesLoopSourceOwner } = await import("../programmatic/hyperframes-loop-source-owner");
const { createHyperframesElectronDspTarget } = await import("../programmatic/hyperframes-electron-dsp");

test("Electron loop materialization uses fresh DSP realms and preserves PCM geometry, transfer, epoch and poison checks", async () => {
	const signal = new AbortController().signal;
	const recipe = { sourceFrames: 3, maxWavBytes: 68, nativeBufferClock: {
		profile: "hyperframes-0.8.139-native-buffer-loop-clock-v1", sampleRate: 48000, outputFrames: 3,
		maxSourceFrames: 3, periodSeconds: 3 / 48000, durationSeconds: 3 / 48000, segments: []
	} } as unknown as HyperframesRateSourceLoop;
	const owner = createHyperframesLoopSourceOwner({ connectionFile: "host-owned", signal, expectedBrowser: browser, expectedHostEpoch: epoch });
	try {
		for (let i = 0; i < 2; i++) {
			const pcm = await owner.materialize({ body: Uint8Array.of(1, 2, 3), recipe, signal });
			expect(pcm.length).toBe(24); expect(pcm.readFloatLE(0)).toBe(0.125); expect(pcm.readFloatLE(20)).toBe(0.75);
			const session = sessions[i]; expect(session.closed).toBe(true);
			expect(session.calls.some(value => value.includes(".configure("))).toBe(true);
			expect(session.calls.some(value => value.includes('.put(0,"AQID")'))).toBe(true);
			expect(session.calls.at(-1)).toBe("window.rocutNativeLoopSourceIO.dispose()");
		}
		changedEpoch = true;
		await expect(owner.materialize({ body: Uint8Array.of(1), recipe, signal })).rejects.toThrow("Host identity changed");
		expect(sessions.at(-1)?.closed).toBe(true); expect(sessions.at(-1)?.calls).toEqual([]);
		await expect(owner.materialize({ body: Uint8Array.of(1), recipe, signal })).rejects.toThrow();
	} finally { await owner.dispose(); changedEpoch = false; }
	nonfinite = true;
	const invalid = createHyperframesLoopSourceOwner({ connectionFile: "host-owned", signal, expectedBrowser: browser, expectedHostEpoch: epoch });
	try {
		await expect(invalid.materialize({ body: Uint8Array.of(1), recipe, signal })).rejects.toThrow("Nonfinite");
		expect(sessions.at(-1)?.closed).toBe(true);
		await expect(invalid.materialize({ body: Uint8Array.of(1), recipe, signal })).rejects.toThrow();
	} finally { await invalid.dispose(); nonfinite = false; }
	await expect(createHyperframesElectronDspTarget({ connectionFile: "host-owned", signal, timeoutMs: 1000,
		expectedBrowser: { ...browser, revision: "changed" }, expectedHostEpoch: epoch })).rejects.toThrow("browser differs");
	expect(sessions.at(-1)?.closed).toBe(true);
});
