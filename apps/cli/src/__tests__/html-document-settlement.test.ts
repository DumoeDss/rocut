import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import {
	htmlAudioAnalysisExpression,
	htmlCaptureExpression,
} from "../programmatic/html-document";
import type { NativeAudioAnalysisConfig } from "../programmatic/remotion-audio-bootstrap";

interface Reply {
	source: object;
	data: { tag: string; ok?: boolean; assets?: unknown; error?: string };
}

/** Exercise the actual generated outer document. Painting intentionally stalls;
 * the inner sandbox's postMessage has already structured-cloned its snapshot. */
function outerDocument(expression: string) {
	const contentWindow = { postMessage() {} };
	const iframe = {
		contentWindow,
		style: { cssText: "" },
		sandbox: "",
		srcdoc: "",
	};
	const paints: (() => void)[] = [];
	let onMessage: ((reply: Reply) => void) | undefined;
	const observation: {
		state: "pending" | "resolved" | "rejected";
		value?: unknown;
		error?: unknown;
	} = { state: "pending" };
	const promise: Promise<unknown> = runInNewContext(expression, {
		window: {},
		document: {
			documentElement: { style: { cssText: "" } },
			body: { style: { cssText: "" }, appendChild: () => {} },
			createElement: () => iframe,
		},
		addEventListener: (_name: string, handler: (reply: Reply) => void) => {
			onMessage = handler;
		},
		requestAnimationFrame: (callback: () => void) => paints.push(callback),
	});
	void promise.then(
		(value) => Object.assign(observation, { state: "resolved", value }),
		(error: unknown) =>
			Object.assign(observation, { state: "rejected", error }),
	);
	return {
		observation,
		paints,
		reply(data: Reply["data"], source = contentWindow) {
			onMessage?.({ source, data });
		},
	};
}

const frame = { frame: 80, time: 3.2, seed: 42 };
const limits = { maxSeconds: 60, maxAssetsPerFrame: 4 };
const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

test("audio observations settle without an outer animation frame", async () => {
	for (const engine of ["hyperframes", "remotion"] as const) {
		for (const mode of [undefined, "analysis"] as const) {
			const analysis: NativeAudioAnalysisConfig = {
				engine,
				mode,
				sources: [],
				limits,
			};
			const page = outerDocument(
				htmlAudioAnalysisExpression("<div></div>", frame, [], analysis),
			);
			const assets = Object.freeze([
				Object.freeze({
					id: "music",
					resourceId: "a".repeat(64),
					time: 3.2,
					volume: 0.5,
				}),
			]);
			page.reply({ tag: "rocut-html-frame", ok: true, assets });
			await flush();
			expect(page.observation.state).toBe("resolved");
			expect(page.observation.value).toBe(assets);
			expect(page.paints).toHaveLength(0);
		}
	}
});

test("pictures, including native soundtrack pictures, retain two paint turns", async () => {
	for (const soundtrack of [
		undefined,
		{ engine: "hyperframes" as const, sources: [], limits },
	]) {
		const page = outerDocument(
			htmlCaptureExpression("<div></div>", frame, [], true, false, soundtrack),
		);
		page.reply({
			tag: "rocut-html-frame",
			ok: true,
			assets: ["not an audio result"],
		});
		await flush();
		expect(page.observation.state).toBe("pending");
		expect(page.paints).toHaveLength(1);
		page.paints.shift()?.();
		await flush();
		expect(page.observation.state).toBe("pending");
		expect(page.paints).toHaveLength(1);
		page.paints.shift()?.();
		await flush();
		expect(page.observation.state).toBe("resolved");
		expect(page.observation.value).toBe(true);
	}
});

test("foreign windows and unrelated messages cannot complete audio observation", async () => {
	const page = outerDocument(
		htmlAudioAnalysisExpression("", frame, [], { sources: [], limits }),
	);
	page.reply(
		{ tag: "rocut-html-frame", ok: true, assets: [] },
		{ postMessage() {} },
	);
	page.reply({ tag: "different-tag", ok: true, assets: [] });
	await flush();
	expect(page.observation.state).toBe("pending");
	expect(page.paints).toHaveLength(0);
	page.reply({ tag: "rocut-html-frame", ok: true, assets: [] });
	await flush();
	expect(page.observation.state).toBe("resolved");
	expect(page.observation.value).toEqual([]);
});

test("sandbox failure rejects analysis and pictures without waiting for paint", async () => {
	for (const expression of [
		htmlAudioAnalysisExpression("", frame, [], { sources: [], limits }),
		htmlCaptureExpression("", frame),
	]) {
		const page = outerDocument(expression);
		page.reply({ tag: "rocut-html-frame", error: "author failed" });
		await flush();
		expect(page.observation.state).toBe("rejected");
		expect(String(page.observation.error)).toBe("Error: author failed");
		expect(page.paints).toHaveLength(0);
	}
});
