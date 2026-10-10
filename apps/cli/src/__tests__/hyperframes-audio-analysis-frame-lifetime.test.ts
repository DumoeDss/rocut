import { expect, test } from "bun:test";
import { collectHyperframesAudioSnapshot } from "../programmatic/hyperframes-audio-analysis-frame";

type Browser = Parameters<typeof collectHyperframesAudioSnapshot>[0];
type Options = Parameters<typeof collectHyperframesAudioSnapshot>[1];

function fixture() {
	const controller = new AbortController();
	const calls: string[] = [];
	const browser = { async send(method: string) {
		calls.push(method);
		if (method === "Target.createTarget") return { targetId: "owned-target" };
		if (method === "Target.attachToTarget") return { sessionId: "owned-session" };
		if (method === "Runtime.evaluate") return { result: { value: { time: 0 } } };
		return {};
	} } as unknown as Browser;
	const options = { width: 16, height: 16, code: "", frame: {}, resources: [],
		analysis: { engine: "hyperframes", sources: [], limits: {} },
		signal: controller.signal } as unknown as Options;
	return { controller, calls, browser, options };
}

test("cancelled collection never creates a private target", async () => {
	const f = fixture();
	const reason = Error("cancel before setup");
	f.controller.abort(reason);
	await expect(collectHyperframesAudioSnapshot(f.browser, f.options)).rejects.toBe(reason);
	expect(f.calls).toEqual([]);
});

test("cancellation during setup never starts authored evaluation", async () => {
	const f = fixture();
	const send = f.browser.send.bind(f.browser);
	f.browser.send = (async (method: string) => {
		const result = await send(method);
		if (method === "Runtime.enable") f.controller.abort(Error("cancel during setup"));
		return result;
	}) as Browser["send"];
	await expect(collectHyperframesAudioSnapshot(f.browser, f.options)).rejects.toThrow("cancel during setup");
	expect(f.calls).not.toContain("Runtime.evaluate");
	// The owner closes the aborted private browser, rather than sending more CDP.
	expect(f.calls).not.toContain("Target.closeTarget");
});

test("successful collection closes only its owned target", async () => {
	const f = fixture();
	expect(await collectHyperframesAudioSnapshot(f.browser, f.options)).toEqual({ time: 0 });
	expect(f.calls.at(-1)).toBe("Target.closeTarget");
});

test("author evaluation failure still closes its owned target", async () => {
	const f = fixture();
	const send = f.browser.send.bind(f.browser);
	f.browser.send = (async (method: string) => {
		if (method === "Runtime.evaluate") throw Error("author failed");
		return send(method);
	}) as Browser["send"];
	await expect(collectHyperframesAudioSnapshot(f.browser, f.options)).rejects.toThrow("author failed");
	expect(f.calls.at(-1)).toBe("Target.closeTarget");
});
